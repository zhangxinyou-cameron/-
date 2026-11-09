import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { AppError, ensure, hash, uid } from './util.mjs';

export const runtimeSpecs = {
  'python-stdio-1': { title: 'Python', executable: 'python', image: 'python:3.12-slim', kind: 'python' },
  'c11-stdio-1': { title: 'C11', executable: 'gcc', image: 'gcc:14', kind: 'c' },
  'cpp17-stdio-1': { title: 'C++17', executable: 'g++', image: 'gcc:14', kind: 'cpp' },
  'iverilog-verilog-1': { title: 'Verilog', executable: 'iverilog', image: 'tech-practice/iverilog:1', kind: 'rtl' }
};
export function childEnv(executable) {
  const result = {};
  // Windows environment keys are case-insensitive. Node keeps only the first
  // spelling when spawning, so PATH/Path duplicates can discard the tool path.
  for (const key of ['SystemRoot', 'WINDIR', 'COMSPEC', 'TEMP', 'TMP', 'LANG']) if (process.env[key]) result[key] = process.env[key];
  result.PATH = path.dirname(executable) + path.delimiter + (process.env.PATH ?? process.env.Path ?? '');
  result.PYTHONIOENCODING = 'utf-8'; result.PYTHONUTF8 = '1';
  return result;
}
export function command(executable, args, { cwd, input = '', timeout = 5000, outputLimit = 1024 * 1024, onProcess, onOutput } = {}) {
  return new Promise(resolve => {
    let stdout = '', stderr = '', bytes = 0, reason = null, settled = false;
    const started = Date.now();
    let child;
    try { child = spawn(executable, args, { cwd, env: childEnv(executable), windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'] }); }
    catch (error) { resolve({ code: null, stdout, stderr: error.message, reason: 'spawn', wallMs: 0 }); return; }
    const stop = why => {
      if (reason) return; reason = why;
      if (process.platform === 'win32' && child.pid) {
        const killer = spawn(path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'taskkill.exe'), ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
        killer.on('error', () => child.kill());
        killer.on('exit', code => { if (code !== 0) child.kill(); });
        const fallback = setTimeout(() => { if (child.exitCode === null) child.kill(); }, 600); fallback.unref();
      } else child.kill('SIGKILL');
    };
    onProcess?.({ child, stop });
    const timer = setTimeout(() => stop('timeout'), timeout);
    const receive = (stream, chunk) => {
      bytes += chunk.length;
      if (bytes <= outputLimit) { const value = chunk.toString('utf8'); if (stream === 'stdout') stdout += value; else stderr += value; onOutput?.(value); }
      else stop('output');
    };
    child.stdout.on('data', chunk => receive('stdout', chunk)); child.stderr.on('data', chunk => receive('stderr', chunk));
    const finish = (code, error = null) => {
      if (settled) return; settled = true; clearTimeout(timer);
      resolve({ code, stdout, stderr: error ? stderr + error.message : stderr, reason: reason ?? (error ? 'spawn' : null), wallMs: Date.now() - started });
    };
    child.on('error', error => finish(null, error)); child.on('close', code => finish(code));
    child.stdin.on('error', () => {}); child.stdin.end(input);
  });
}
async function locate(names) {
  for (const name of names.filter(Boolean)) {
    if (path.isAbsolute(name)) { if (fs.existsSync(name) && fs.statSync(name).isFile()) return name; continue; }
    const lookup = await command(process.platform === 'win32' ? path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'where.exe') : '/usr/bin/which', [name], { timeout: 2000 });
    const candidates = lookup.stdout.trim().split(/\r?\n/).filter(s => s && !s.includes('WindowsApps') && fs.existsSync(s));
    if (candidates[0]) return candidates[0];
  }
  return null;
}
export class Environments {
  constructor(store, assetDir, envRoot) { this.store = store; this.assetDir = assetDir; this.envRoot = envRoot; this.cached = null; this.lastProbe = 0; this.install = null; }
  async probe(force = false) {
    if (!force && this.cached && Date.now() - this.lastProbe < 20000) return this.cached;
    const settings = this.store.getSettings(), configured = settings.paths;
    const portableVerilog = [path.join(this.envRoot, 'verilog-msys2', 'ucrt64', 'bin', 'iverilog.exe')];
    // Source and portable distributions have different depths. Discover the
    // workspace-local toolchain without requiring a global PATH change.
    for (let dir = path.resolve(this.assetDir), depth = 0; depth < 8; depth++) {
      portableVerilog.push(path.join(dir, 'tools', 'verilog-msys2', 'ucrt64', 'bin', 'iverilog.exe'));
      const parent = path.dirname(dir); if (parent === dir) break; dir = parent;
    }
    const candidates = {
      'python-stdio-1': [configured.python, path.join(this.assetDir, 'python', 'python.exe'), path.join(this.envRoot, 'python', 'python.exe'), 'python3', 'python',
        path.join(os.homedir(), '.cache', 'codex-runtimes', 'codex-primary-runtime', 'dependencies', 'python', 'python.exe')],
      'c11-stdio-1': [configured.gcc, 'gcc', 'clang', 'C:\\msys64\\ucrt64\\bin\\gcc.exe', 'C:\\msys64\\mingw64\\bin\\gcc.exe'],
      'cpp17-stdio-1': [configured.cpp, 'g++', 'clang++', 'C:\\msys64\\ucrt64\\bin\\g++.exe', 'C:\\msys64\\mingw64\\bin\\g++.exe'],
      'iverilog-verilog-1': [configured.iverilog, ...portableVerilog, 'iverilog', 'C:\\msys64\\ucrt64\\bin\\iverilog.exe', 'C:\\iverilog\\bin\\iverilog.exe']
    };
    const native = await Promise.all(Object.entries(runtimeSpecs).map(async ([id, spec]) => {
      const executable = await locate(candidates[id]);
      let result = executable ? await command(executable, [spec.kind === 'rtl' ? '-V' : '--version'], { timeout: 4000 }) : null;
      const vvp = spec.kind === 'rtl' ? await locate([configured.vvp, executable ? path.join(path.dirname(executable), 'vvp.exe') : null, 'vvp']) : null;
      return { id, ...spec, available: !!result && result.code === 0 && (spec.kind !== 'rtl' || !!vvp), executable, vvp,
        version: (result?.stdout || result?.stderr || '').split(/\r?\n/)[0].slice(0, 200), backend: 'native' };
    }));
    const docker = await locate([configured.docker, 'docker', 'C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.exe']);
    const engine = docker ? await command(docker, ['info', '--format', '{{.ServerVersion}}'], { timeout: 5000 }) : null;
    const dockerReady = !!engine && engine.code === 0;
    const containers = await Promise.all(Object.entries(runtimeSpecs).map(async ([id, spec]) => {
      const result = dockerReady ? await command(docker, ['image', 'inspect', spec.image, '--format', '{{.Id}}'], { timeout: 3000 }) : null;
      const imageId = result?.code === 0 ? result.stdout.trim() : null;
      return { id, ...spec, available: !!imageId, imageId, backend: 'docker', executable: docker, version: imageId?.slice(0, 22) ?? '' };
    }));
    this.cached = { native, containers, docker: { available: dockerReady, executable: docker, version: engine?.stdout.trim() ?? '', error: engine?.stderr.slice(0, 400) ?? '未检测到 Docker' }, currentBackend: settings.backend };
    this.lastProbe = Date.now(); return this.cached;
  }
  async resolve(id, bankId) {
    ensure(runtimeSpecs[id], '当前版本不支持这个运行环境：' + id, 'ENV_ERROR');
    const settings = this.store.getSettings(), probed = await this.probe();
    if (settings.backend === 'native') ensure(settings.trustedBanks.includes(bankId + ':' + hash(this.store.bank(bankId))), '请先确认信任此题库的当前内容，或使用容器后端', 'ENV_ERROR');
    const runtime = (settings.backend === 'native' ? probed.native : probed.containers).find(r => r.id === id);
    ensure(runtime?.available, settings.backend === 'native' ? '该工具未配置，请在运行环境中选择可执行文件' : '容器引擎或题目镜像未就绪，请先配置环境', 'ENV_ERROR');
    const lock = { ...runtime, runtimeId: id, id: hash({ backend: runtime.backend, id, executable: runtime.executable, version: runtime.version, imageId: runtime.imageId ?? null,
      toolHash: runtime.backend === 'native' ? hash(fs.readFileSync(runtime.executable)) : null }), adapterVersion: '1.0.0' };
    this.store.transaction(() => this.store.db.run('INSERT OR IGNORE INTO runtime_locks VALUES(?,?,?)', [lock.id, JSON.stringify(lock), new Date().toISOString()]));
    return lock;
  }
  plan(id) {
    ensure(runtimeSpecs[id], '不支持这个环境预设');
    const spec = runtimeSpecs[id];
    const plan = { id: uid(), runtimeId: id, title: spec.title + ' 容器环境', image: spec.image,
      source: id === 'iverilog-verilog-1' ? 'Docker 官方 Debian 基础镜像与 Debian 软件仓库' : 'Docker 官方镜像',
      changes: '仅准备应用使用的容器镜像；需要已安装并启动的 Docker。可能下载数百 MiB。',
      commands: id === 'iverilog-verilog-1' ? ['docker build -t tech-practice/iverilog:1 -', 'FROM debian:bookworm-slim\nRUN apt-get update && apt-get install -y --no-install-recommends iverilog && rm -rf /var/lib/apt/lists/*'] : ['docker pull ' + spec.image] };
    this.pendingPlan = { ...plan, hash: hash(plan) }; return this.pendingPlan;
  }
  async apply(planId, planHash) {
    ensure(!this.install || !['running'].includes(this.install.status), '已有环境安装任务正在执行');
    ensure(this.pendingPlan?.id === planId && this.pendingPlan.hash === planHash, '安装计划已变化，请重新确认');
    const plan = this.pendingPlan, environment = await this.probe();
    ensure(environment.docker.available, '请先安装并启动 Docker Desktop，再准备容器环境', 'ENV_ERROR');
    const job = { id: uid(), title: plan.title, status: 'running', logs: '', createdAt: new Date().toISOString() };
    this.install = job; this.pendingPlan = null;
    const execute = async () => {
      const docker = environment.docker.executable;
      const args = plan.runtimeId === 'iverilog-verilog-1' ? ['build', '--tag', plan.image, '-'] : ['pull', plan.image];
      const result = await command(docker, args, { input: plan.runtimeId === 'iverilog-verilog-1' ? plan.commands[1] : '', timeout: 20 * 60000,
        outputLimit: 4 * 1024 * 1024, onOutput: value => { job.logs = (job.logs + value).slice(-60000); } });
      const verified = await this.probe(true);
      job.status = result.code === 0 && verified.containers.find(r => r.id === plan.runtimeId)?.available ? 'ready' : 'failed';
      job.error = job.status === 'failed' ? '下载或独立环境检查未通过，可查看日志后重试' : null;
      this.store.transaction(() => this.store.db.run('INSERT INTO env_installs VALUES(?,?,?)', [job.id, JSON.stringify(job), job.createdAt]));
    };
    execute().catch(error => { job.status = 'failed'; job.error = error.message; });
    return job;
  }
}
