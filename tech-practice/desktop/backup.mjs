import fs from 'node:fs';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { atomicWrite, ensure, hash, listFiles, localDay, uid, within } from './util.mjs';
import { readZip } from './qbank.mjs';

export class Backups {
  constructor(store, root) { this.store = store; this.root = root; fs.mkdirSync(root, { recursive: true }); }
  create(file) {
    this.store.save();
    const zip = new AdmZip(), files = {};
    const data = Buffer.from(this.store.db.export()); files['learning.sqlite'] = hash(data); zip.addFile('learning.sqlite', data);
    let total = data.length;
    for (const relative of listFiles(path.join(this.store.dataDir, 'artifacts'))) {
      const item = path.join(this.store.dataDir, 'artifacts', relative), size = fs.statSync(item).size;
      total += size; ensure(total <= 500 * 1024 * 1024, '备份内容超过 500 MiB，请先导出历史波形');
      const bytes = fs.readFileSync(item); const name = 'artifacts/' + relative;
      files[name] = hash(bytes); zip.addFile(name, bytes);
    }
    zip.addFile('manifest.json', Buffer.from(JSON.stringify({ format: 'tech-practice-backup', version: 1, createdAt: new Date().toISOString(), files }), 'utf8'));
    atomicWrite(file, zip.toBuffer());
    return { file, createdAt: new Date().toISOString(), bytes: fs.statSync(file).size, count: Object.keys(files).length };
  }
  automatic(reason = 'daily') {
    const day = localDay(); const file = path.join(this.root, `${day}-${reason}.zip`);
    if (reason !== 'daily' || !fs.existsSync(file)) this.create(file);
    const daily = fs.readdirSync(this.root).filter(f => /-daily\.zip$/.test(f)).sort().reverse();
    for (const old of daily.slice(7)) fs.unlinkSync(path.join(this.root, old));
    const events = fs.readdirSync(this.root).filter(f => !/-daily\.zip$/.test(f)).sort().reverse();
    for (const old of events.slice(12)) fs.unlinkSync(path.join(this.root, old));
    return file;
  }
  list() { return fs.readdirSync(this.root).filter(f => f.endsWith('.zip')).sort().reverse().map(name => ({ name, bytes: fs.statSync(path.join(this.root, name)).size })); }
  inspect(file) {
    const entries = readZip(fs.readFileSync(file), 500 * 1024 * 1024, { backup: true });
    ensure(entries.has('manifest.json') && entries.has('learning.sqlite'), '不是本软件的有效备份');
    const manifest = JSON.parse(entries.get('manifest.json').toString('utf8'));
    ensure(manifest.format === 'tech-practice-backup' && manifest.version === 1 && manifest.files && typeof manifest.files === 'object', '备份版本不支持');
    ensure(entries.size === Object.keys(manifest.files).length + 1, '备份文件清单不一致');
    for (const [name, digest] of Object.entries(manifest.files)) {
      ensure(name === 'learning.sqlite' || name.startsWith('artifacts/'), '备份包含不允许恢复的文件');
      ensure(entries.has(name) && hash(entries.get(name)) === digest, '备份摘要校验失败：' + name);
    }
    const test = new this.store.SQL.Database(entries.get('learning.sqlite'));
    try {
      ensure(test.exec('PRAGMA integrity_check')[0]?.values[0]?.[0] === 'ok', '备份数据库损坏');
      const version = test.exec("SELECT value FROM meta WHERE key='schema_version'")[0]?.values[0]?.[0];
      ensure(version === '1', '备份数据库版本不支持');
      for (const name of ['banks', 'questions', 'attempts', 'drafts', 'annotations', 'progress']) test.exec('SELECT count(*) FROM ' + name);
    } finally { test.close(); }
    return { entries, manifest };
  }
  restore(file) {
    const { entries, manifest } = this.inspect(file);
    this.automatic('before-restore');
    const parent = path.dirname(this.store.dataDir), stage = path.join(parent, 'restore-stage-' + uid()), old = path.join(parent, 'restore-old-' + uid());
    fs.mkdirSync(stage, { recursive: true });
    for (const [name, data] of entries) {
      if (name === 'manifest.json') continue;
      const target = within(stage, name); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, data);
    }
    try {
      fs.renameSync(this.store.dataDir, old);
      fs.renameSync(stage, this.store.dataDir);
      this.store.load();
      this.store.setSettings({ backend: 'docker', trustedBanks: [], paths: {} });
      fs.rmSync(old, { recursive: true, force: true });
    } catch (error) {
      if (fs.existsSync(old)) {
        if (fs.existsSync(this.store.dataDir)) fs.renameSync(this.store.dataDir, stage + '-failed');
        fs.renameSync(old, this.store.dataDir); this.store.load();
      }
      throw error;
    } finally { if (fs.existsSync(stage)) fs.rmSync(stage, { recursive: true, force: true }); }
    return { restoredAt: new Date().toISOString(), originalCreatedAt: manifest.createdAt };
  }
}
