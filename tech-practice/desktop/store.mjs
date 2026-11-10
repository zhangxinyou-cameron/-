import fs from 'node:fs';
import path from 'node:path';
import initSqlJs from 'sql.js';
import { AppError, atomicWrite, canonical, ensure, hash, identity, localDay, uid } from './util.mjs';
import { questionFiles, questionHash } from './qbank.mjs';

export const defaultSettings = {
  backend: 'docker', theme: 'light', dailyTarget: 12, timeZone: 'Asia/Shanghai',
  paths: {}, trustedBanks: [], editorFontSize: 14, maxMemoryMiB: 512, maxJobWallMs: 120000,
  lastQuestion: null, lastSession: null
};
export class Store {
  constructor(dataDir, wasmPath) { this.dataDir = dataDir; this.file = path.join(dataDir, 'learning.sqlite'); this.wasmPath = wasmPath; }
  async init() {
    this.SQL = await initSqlJs({ locateFile: () => this.wasmPath });
    fs.mkdirSync(this.dataDir, { recursive: true });
    this.load();
    this.db.run(`CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS banks(id TEXT PRIMARY KEY,title TEXT,version TEXT,payload TEXT NOT NULL,archived INTEGER DEFAULT 0,updated_at TEXT);
      CREATE TABLE IF NOT EXISTS releases(id TEXT PRIMARY KEY,bank_id TEXT,version TEXT,payload TEXT,created_at TEXT);
      CREATE TABLE IF NOT EXISTS questions(key TEXT PRIMARY KEY,bank_id TEXT,id TEXT,revision INTEGER,current INTEGER DEFAULT 1,payload TEXT NOT NULL,files TEXT NOT NULL,hash TEXT,quality TEXT DEFAULT 'validated');
      CREATE INDEX IF NOT EXISTS question_current ON questions(current,bank_id);
      CREATE TABLE IF NOT EXISTS drafts(key TEXT PRIMARY KEY,payload TEXT,updated_at TEXT);
      CREATE TABLE IF NOT EXISTS attempts(id TEXT PRIMARY KEY,request_id TEXT UNIQUE,qkey TEXT,identity TEXT,bank_id TEXT,status TEXT,payload TEXT NOT NULL,created_at TEXT,assisted INTEGER);
      CREATE INDEX IF NOT EXISTS attempts_question ON attempts(qkey,created_at);
      CREATE TABLE IF NOT EXISTS progress(qkey TEXT PRIMARY KEY,identity TEXT,stage INTEGER DEFAULT 0,due_at TEXT,last_pass_day TEXT,pass_days TEXT DEFAULT '[]',wrong INTEGER DEFAULT 0,corrected INTEGER DEFAULT 0,suspended INTEGER DEFAULT 0,reason TEXT DEFAULT '',updated_at TEXT);
      CREATE TABLE IF NOT EXISTS annotations(identity TEXT PRIMARY KEY,bookmarked INTEGER DEFAULT 0,collection TEXT DEFAULT '默认收藏',note TEXT DEFAULT '',updated_at TEXT);
      CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY,payload TEXT NOT NULL,updated_at TEXT);
      CREATE TABLE IF NOT EXISTS runtime_locks(id TEXT PRIMARY KEY,payload TEXT NOT NULL,created_at TEXT);
      CREATE TABLE IF NOT EXISTS env_installs(id TEXT PRIMARY KEY,payload TEXT NOT NULL,created_at TEXT);`);
    const version = this.one('SELECT value FROM meta WHERE key=?', ['schema_version']);
    ensure(!version || version.value === '1', '学习数据库版本不受支持', 'E_DB_VERSION');
    this.db.run('INSERT OR IGNORE INTO meta VALUES(?,?)', ['schema_version', '1']);
    this.save(); return this;
  }
  load() {
    if (this.db) this.db.close();
    this.db = fs.existsSync(this.file) ? new this.SQL.Database(fs.readFileSync(this.file)) : new this.SQL.Database();
    const result = this.db.exec('PRAGMA integrity_check');
    ensure(result[0]?.values[0]?.[0] === 'ok', '学习数据库损坏，请从备份恢复', 'E_DB');
  }
  all(sql, params = []) {
    const statement = this.db.prepare(sql);
    try { statement.bind(params); const rows = []; while (statement.step()) rows.push(statement.getAsObject()); return rows; }
    finally { statement.free(); }
  }
  one(sql, params = []) { return this.all(sql, params)[0] ?? null; }
  save() { atomicWrite(this.file, Buffer.from(this.db.export())); }
  transaction(fn) {
    if (this.inTransaction) return fn();
    const snapshot = this.db.export();
    this.inTransaction = true;
    try { this.db.run('BEGIN IMMEDIATE'); const result = fn(); this.db.run('COMMIT'); this.save(); return result; }
    catch (error) { this.db.close(); this.db = new this.SQL.Database(snapshot); throw error; }
    finally { this.inTransaction = false; }
  }
  getSettings() { const row = this.one('SELECT value FROM meta WHERE key=?', ['settings']); return { ...defaultSettings, ...row ? JSON.parse(row.value) : {} }; }
  setSettings(patch) {
    const previous = this.getSettings();
    const allowed = Object.keys(defaultSettings), clean = {};
    for (const [key, value] of Object.entries(patch)) if (allowed.includes(key)) clean[key] = value;
    const next = { ...previous, ...clean };
    ensure(['docker', 'native'].includes(next.backend), '无效执行后端');
    ensure(['light', 'dark'].includes(next.theme), '无效主题');
    ensure(Number.isInteger(next.dailyTarget) && next.dailyTarget > 0 && next.dailyTarget <= 200, '每日目标题数应为 1 到 200');
    ensure(Number.isInteger(next.editorFontSize) && next.editorFontSize >= 11 && next.editorFontSize <= 24, '编辑器字号应为 11 到 24');
    ensure(Number.isInteger(next.maxMemoryMiB) && next.maxMemoryMiB >= 64 && next.maxMemoryMiB <= 4096, '内存上限应为 64 到 4096 MiB');
    ensure(Number.isInteger(next.maxJobWallMs) && next.maxJobWallMs >= 1000 && next.maxJobWallMs <= 600000, '任务时限应为 1 到 600 秒');
    try { localDay(new Date(), next.timeZone); } catch { throw new AppError('无效时区'); }
    ensure(Array.isArray(next.trustedBanks) && next.trustedBanks.every(s => typeof s === 'string'), '无效题库信任设置');
    this.transaction(() => this.db.run('INSERT OR REPLACE INTO meta VALUES(?,?)', ['settings', JSON.stringify(next)]));
    return next;
  }
  bank(id) { const row = this.one('SELECT * FROM banks WHERE id=?', [id]); ensure(row, '题库不存在', 'NOT_FOUND'); return JSON.parse(row.payload); }
  previewImport(bank) {
    const counts = { added: 0, updated: 0, unchanged: 0, conflicts: 0, older: 0 }, rows = [];
    for (const q of bank.questions) {
      const old = this.one('SELECT revision,hash FROM questions WHERE bank_id=? AND id=? AND current=1', [bank.bank_id, q.id]);
      let action = !old ? 'added' : q.revision > old.revision ? 'updated' : q.revision < old.revision ? 'older' : old.hash === questionHash(q, bank) ? 'unchanged' : 'conflicts';
      counts[action]++; rows.push({ id: q.id, title: q.title, revision: q.revision, previousRevision: old?.revision ?? null, action });
    }
    return { bankId: bank.bank_id, title: bank.title, version: bank.bank_version, count: bank.questions.length, counts, rows };
  }
  importBank(bank) {
    const preview = this.previewImport(bank);
    ensure(!preview.counts.conflicts, '同一 revision 的内容存在冲突，请先递增题目 revision', 'E_CONFLICT', preview);
    return this.transaction(() => {
      const now = new Date().toISOString();
      const existing = this.one('SELECT payload FROM banks WHERE id=?', [bank.bank_id]);
      const merged = existing ? JSON.parse(existing.payload) : { ...bank, questions: [], files: {}, knowledge_points: [] };
      const questions = new Map(merged.questions.map(q => [q.id, q]));
      for (const q of bank.questions) {
        const action = preview.rows.find(r => r.id === q.id).action;
        if (!['added', 'updated'].includes(action)) continue;
        const key = bank.bank_id + '/' + q.id + '@' + q.revision;
        this.db.run('UPDATE questions SET current=0 WHERE bank_id=? AND id=?', [bank.bank_id, q.id]);
        this.db.run('INSERT INTO questions(key,bank_id,id,revision,payload,files,hash) VALUES(?,?,?,?,?,?,?)', [key, bank.bank_id, q.id, q.revision, JSON.stringify(q), JSON.stringify(questionFiles(q, bank)), questionHash(q, bank)]);
        questions.set(q.id, q);
      }
      merged.questions = [...questions.values()];
      merged.files = { ...merged.files, ...bank.files };
      const currentFileSnapshots = this.all('SELECT files FROM questions WHERE bank_id=? AND current=1', [bank.bank_id]);
      const referenced = {};
      for (const snapshot of currentFileSnapshots) for (const [name, file] of Object.entries(JSON.parse(snapshot.files))) {
        ensure(!Object.hasOwn(referenced, name) || canonical(referenced[name]) === canonical(file), '当前题目引用的同名文件内容不同，请修改 source_path：' + name, 'E_FILE_CONFLICT');
        referenced[name] = file;
      }
      merged.files = { ...merged.files, ...referenced };
      const points = new Map(merged.knowledge_points.map(p => [p.id, p]));
      for (const p of bank.knowledge_points) points.set(p.id, p);
      merged.knowledge_points = [...points.values()];
      for (const k of ['title', 'description', 'authors', 'license', 'locale']) merged[k] = bank[k];
      if (!existing || compareVersion(bank.bank_version, merged.bank_version) >= 0) merged.bank_version = bank.bank_version;
      merged.bank_id = bank.bank_id; merged.schema_version = '1.0';
      this.db.run('INSERT INTO banks(id,title,version,payload,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,version=excluded.version,payload=excluded.payload,updated_at=excluded.updated_at,archived=0', [bank.bank_id, merged.title, merged.bank_version, JSON.stringify(merged), now]);
      this.db.run('INSERT INTO releases VALUES(?,?,?,?,?)', [uid(), bank.bank_id, bank.bank_version, JSON.stringify(bank), now]);
      return preview;
    });
  }
  listBanks() {
    const rows = this.all('SELECT id,title,version,archived,updated_at FROM banks ORDER BY updated_at DESC');
    return rows.map(b => {
      const questions = this.listQuestions({ bankId: b.id, includeArchived: true });
      const bank = this.bank(b.id);
      return { ...b, description: bank.description, count: questions.length, practiced: questions.filter(q => q.attemptCount > 0).length,
        solved: questions.filter(q => q.passed).length, due: questions.filter(q => q.due).length,
        domains: [...new Set(questions.map(q => q.domain))], types: [...new Set(questions.map(q => q.type))] };
    });
  }
  listQuestions(filters = {}) {
    const now = new Date().toISOString();
    const rows = this.all(`SELECT q.*,b.title bank_title,b.archived,p.stage,p.due_at,p.wrong,p.corrected,p.suspended,p.reason,p.pass_days,
      a.bookmarked,a.note,a.collection,(SELECT count(*) FROM attempts t WHERE t.qkey=q.key AND t.status IN('AC','WA','CE','RE','TLE','MLE','OLE')) attempt_count,
      (SELECT count(*) FROM attempts t WHERE t.qkey=q.key AND t.status='AC') pass_count
      FROM questions q JOIN banks b ON q.bank_id=b.id LEFT JOIN progress p ON p.qkey=q.key
      LEFT JOIN annotations a ON a.identity=q.bank_id||'/'||q.id WHERE q.current=1`);
    return rows.filter(r => (filters.includeArchived || !r.archived) && (!filters.bankId || r.bank_id === filters.bankId)).map(row => {
      const q = JSON.parse(row.payload);
      return { key: row.key, bankId: row.bank_id, bankTitle: row.bank_title, id: q.id, revision: q.revision, type: q.type, title: q.title,
        domain: q.domain, knowledge_point_ids: q.knowledge_point_ids, difficulty: q.difficulty, estimated_minutes: q.estimated_minutes,
        runtimeRef: q.execution?.runtime_ref ?? null, bookmarked: !!row.bookmarked, note: row.note ?? '', collection: row.collection ?? '默认收藏',
        wrong: !!row.wrong, corrected: !!row.corrected, reason: row.reason ?? '', due: !!row.due_at && row.due_at <= now && !row.suspended,
        dueAt: row.due_at, stage: row.stage ?? 0, suspended: !!row.suspended, passed: row.pass_count > 0, attemptCount: row.attempt_count,
        quality: row.quality, mastery: row.stage >= 2 && JSON.parse(row.pass_days ?? '[]').length >= 2 ? '暂时掌握' : row.due_at ? '待复习' : row.attempt_count ? '学习中' : '未学' };
    });
  }
  question(key) {
    const row = this.one('SELECT * FROM questions WHERE key=?', [key]); ensure(row, '题目不存在', 'NOT_FOUND');
    const q = JSON.parse(row.payload), bank = this.bank(row.bank_id);
    return { ...q, key, bankId: row.bank_id, bankTitle: bank.title, files: JSON.parse(row.files), quality: row.quality,
      pointNames: q.knowledge_point_ids.map(id => bank.knowledge_points.find(p => p.id === id)?.name ?? id),
      annotation: this.annotation(row.bank_id + '/' + q.id), draft: this.draft(key),
      attempts: this.all('SELECT payload FROM attempts WHERE qkey=? ORDER BY created_at DESC LIMIT 30', [key]).map(x => JSON.parse(x.payload)) };
  }
  draft(key) { const r = this.one('SELECT payload FROM drafts WHERE key=?', [key]); return r ? JSON.parse(r.payload) : null; }
  saveDraft(key, draft) {
    ensure(typeof draft === 'object' && Buffer.byteLength(JSON.stringify(draft)) <= 2 * 1024 * 1024, '草稿过大');
    ensure(this.one('SELECT key FROM questions WHERE key=?', [key]), '题目不存在');
    this.transaction(() => this.db.run('INSERT OR REPLACE INTO drafts VALUES(?,?,?)', [key, JSON.stringify(draft), new Date().toISOString()]));
    return true;
  }
  annotation(id) { return this.one('SELECT * FROM annotations WHERE identity=?', [id]) ?? { identity: id, bookmarked: 0, collection: '默认收藏', note: '' }; }
  annotate(id, patch) {
    const next = { ...this.annotation(id), ...patch };
    ensure(typeof next.note === 'string' && next.note.length < 200000 && typeof next.collection === 'string' && next.collection.length < 100, '笔记或收藏夹内容过长');
    this.transaction(() => this.db.run('INSERT OR REPLACE INTO annotations VALUES(?,?,?,?,?)', [id, next.bookmarked ? 1 : 0, next.collection, next.note, new Date().toISOString()]));
    return next;
  }
  recordAttempt(qkey, result, { answer = null, codeFiles = null, assisted = false, requestId = uid(), elapsedMs = 0 } = {}) {
    const previous = this.one('SELECT payload FROM attempts WHERE request_id=?', [requestId]);
    if (previous) return JSON.parse(previous.payload);
    const q = this.question(qkey), now = new Date().toISOString();
    const attempt = { ...result, id: uid(), requestId, qkey, bankId: q.bankId, questionId: q.id, revision: q.revision,
      questionTitle: q.title, type: q.type, answer, codeFiles, assisted, elapsedMs, createdAt: now };
    return this.transaction(() => {
      this.db.run('INSERT INTO attempts VALUES(?,?,?,?,?,?,?,?,?)', [attempt.id, requestId, qkey, identity(q.bankId, q.id), q.bankId, result.status, JSON.stringify(attempt), now, assisted ? 1 : 0]);
      if (['AC', 'WA', 'CE', 'RE', 'TLE', 'MLE', 'OLE'].includes(result.status)) this.updateReview(q, result.status === 'AC', assisted, now);
      return attempt;
    });
  }
  updateReview(q, correct, assisted, now) {
    const previous = this.one('SELECT * FROM progress WHERE qkey=?', [q.key]);
    let stage = previous?.stage ?? 0, wrong = previous?.wrong ?? 0, corrected = previous?.corrected ?? 0;
    const day = localDay(new Date(now), this.getSettings().timeZone);
    const days = JSON.parse(previous?.pass_days ?? '[]');
    let due, lastPassDay = previous?.last_pass_day ?? null;
    if (!correct || assisted) { stage = 0; due = new Date(Date.parse(now) + 10 * 60000).toISOString(); if (!correct) { wrong = 1; corrected = 0; } }
    else {
      if (stage === 0 || lastPassDay !== day && previous?.due_at <= now) { stage = Math.min(5, stage + 1); }
      lastPassDay = day; if (!days.includes(day)) days.push(day);
      due = new Date(Date.parse(now) + [0, 1, 3, 7, 14, 30][stage] * 86400000).toISOString();
      if (wrong) corrected = 1;
    }
    this.db.run('INSERT OR REPLACE INTO progress(qkey,identity,stage,due_at,last_pass_day,pass_days,wrong,corrected,suspended,reason,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
      [q.key, identity(q.bankId, q.id), stage, due, lastPassDay, JSON.stringify(days), wrong, corrected, previous?.suspended ?? 0, previous?.reason ?? '', now]);
  }
  reviewAction(key, action, reason = '') {
    const q = this.question(key), previous = this.one('SELECT * FROM progress WHERE qkey=?', [key]);
    if (!previous) this.transaction(() => this.updateReview(q, false, false, new Date().toISOString()));
    ensure(['pause', 'resume', 'removeWrong', 'restoreWrong', 'reason', 'now'].includes(action), '无效复习操作');
    this.transaction(() => {
      if (action === 'pause' || action === 'resume') this.db.run('UPDATE progress SET suspended=? WHERE qkey=?', [action === 'pause' ? 1 : 0, key]);
      if (action === 'removeWrong' || action === 'restoreWrong') this.db.run('UPDATE progress SET wrong=? WHERE qkey=?', [action === 'restoreWrong' ? 1 : 0, key]);
      if (action === 'now') this.db.run('UPDATE progress SET due_at=?,suspended=0 WHERE qkey=?', [new Date().toISOString(), key]);
      if (action === 'reason') this.db.run('UPDATE progress SET reason=? WHERE qkey=?', [String(reason).slice(0, 200), key]);
    }); return true;
  }
  startSession(keys, mode, seed = 0, pluginContext = null) {
    ensure(Array.isArray(keys) && keys.length > 0 && keys.length <= 10000 && ['sequence', 'random', 'review', 'topic', 'wrong'].includes(mode), '练习范围为空或模式无效');
    const unique = [...new Set(keys)]; unique.forEach(k => ensure(this.one('SELECT key FROM questions WHERE key=?', [k]), '练习中包含不存在的题目'));
    if (mode === 'random') {
      let state = seed || Date.now() % 2147483647; seed = state;
      for (let i = unique.length - 1; i > 0; i--) { state = state * 16807 % 2147483647; const j = state % (i + 1); [unique[i], unique[j]] = [unique[j], unique[i]]; }
    }
    const session = { id: uid(), mode, keys: unique, index: 0, seed, createdAt: new Date().toISOString(), ...(pluginContext ? {pluginContext} : {}) };
    this.transaction(() => this.db.run('INSERT INTO sessions VALUES(?,?,?)', [session.id, JSON.stringify(session), session.createdAt]));
    this.setSettings({ lastSession: session.id, lastQuestion: unique[0] }); return session;
  }
  session(id) { const row = this.one('SELECT payload FROM sessions WHERE id=?', [id]); return row ? JSON.parse(row.payload) : null; }
  moveSession(id, index) {
    const session = this.session(id); ensure(session && Number.isInteger(index) && index >= 0 && index < session.keys.length, '练习进度无效');
    session.index = index;
    this.transaction(() => this.db.run('UPDATE sessions SET payload=?,updated_at=? WHERE id=?', [JSON.stringify(session), new Date().toISOString(), id]));
    this.setSettings({ lastQuestion: session.keys[index], lastSession: id }); return session;
  }
  overview() {
    const questions = this.listQuestions(), banks = this.listBanks(), points = banks.flatMap(b => this.bank(b.id).knowledge_points), settings = this.getSettings(), day = localDay(new Date(), settings.timeZone);
    const attempts = this.all('SELECT payload FROM attempts ORDER BY created_at DESC').map(r => JSON.parse(r.payload));
    const effective = attempts.filter(a => ['AC', 'WA', 'CE', 'RE', 'TLE', 'MLE', 'OLE'].includes(a.status));
    const today = effective.filter(a => localDay(new Date(a.createdAt), settings.timeZone) === day);
    const recentDays = Array.from({ length: 14 }, (_, i) => localDay(new Date(Date.now() - (13 - i) * 86400000), settings.timeZone));
    const recent = recentDays.map(date => ({ date, count: new Set(effective.filter(a => localDay(new Date(a.createdAt), settings.timeZone) === date).map(a => a.bankId + '/' + a.questionId)).size }));
    const first = new Map();
    for (const a of [...effective].reverse()) if (['single_choice', 'multiple_choice', 'true_false'].includes(a.type) && !first.has(a.bankId + '/' + a.questionId)) first.set(a.bankId + '/' + a.questionId, a);
    const firstValues = [...first.values()];
    const reasons = {};
    for (const a of effective.filter(a => a.status !== 'AC')) reasons[a.status] = (reasons[a.status] ?? 0) + 1;
    const codeAttempts = effective.filter(a => ['code', 'rtl'].includes(a.type));
    const independentPassed = new Set(codeAttempts.filter(a => a.status === 'AC' && !a.assisted).map(a => a.bankId + '/' + a.questionId)).size;
    const codeDenom = new Set(codeAttempts.map(a => a.bankId + '/' + a.questionId)).size;
    return { banks, total: questions.length, solved: questions.filter(q => q.passed).length, due: questions.filter(q => q.due).length,
      wrong: questions.filter(q => q.wrong && !q.corrected).length, todayCount: new Set(today.map(a => a.bankId + '/' + a.questionId)).size,
      todayPass: new Set(today.filter(a => a.status === 'AC' && !a.assisted).map(a => a.bankId + '/' + a.questionId)).size,
      target: settings.dailyTarget, recent, recentAttempts: attempts.slice(0, 12), totalAttempts: effective.length,
      firstAccuracy: firstValues.length ? Math.round(100 * firstValues.filter(a => a.status === 'AC').length / firstValues.length) : null,
      independentCodeRate: codeDenom ? Math.round(100 * independentPassed / codeDenom) : null, reasons,
      topics: [...new Set(questions.flatMap(q => q.knowledge_point_ids))].map(id => ({ id, title: points.find(p => p.id === id)?.name ?? id,
        total: questions.filter(q => q.knowledge_point_ids.includes(id)).length, passed: questions.filter(q => q.knowledge_point_ids.includes(id) && q.passed).length })),
      lastSession: settings.lastSession ? this.session(settings.lastSession) : null };
  }
}
function compareVersion(a, b) {
  const aa = a.split('.').map(Number), bb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (aa[i] !== bb[i]) return aa[i] - bb[i];
  return 0;
}
