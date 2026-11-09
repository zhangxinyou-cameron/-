import fs from 'node:fs';
import path from 'node:path';
import { command, runtimeSpecs } from './environment.mjs';
import { AppError, compareOutput, ensure, hash, uid, within } from './util.mjs';

export class Runner {
  constructor(store, environments, jobsRoot) { this.store = store; this.environments = environments; this.jobsRoot = jobsRoot; this.jobs = new Map(); this.active = null; }
  start({ key, mode, files, assisted = false, requestId = uid(), elapsedMs = 0, customInput = null }) {
    ensure(!this.active, '已有代码任务正在运行，请等待完成或先停止', 'BUSY');
    ensure(['sample', 'submit', 'reference'].includes(mode), '无效运行模式');
    const q = this.store.question(key); ensure(q.execution, '此题不需要代码运行器');
    const validTargets = q.execution.starter_files.map(m => m.target_path);
    ensure(files && typeof files === 'object' && Object.keys(files).every(k => validTargets.includes(k) && typeof files[k] === 'string') && Buffer.byteLength(JSON.stringify(files)) <= 2 * 1024 * 1024, '无效代码文件');
    ensure(customInput === null || (typeof customInput === 'string' && Buffer.byteLength(customInput) <= 1024 * 1024), '自定义输入过大');
    const job = { id: uid(), key, mode, status: 'queued', logs: '', result: null, createdAt: new Date().toISOString(), cancel: false, caseResults: [] };
    this.store.transaction(() => this.store.db.run('INSERT INTO meta VALUES(?,?)', ['pending-job:' + job.id, JSON.stringify({ key, mode, codeFiles: files, assisted, requestId, elapsedMs })]));
    this.jobs.set(job.id, job); this.active = job;
    this.execute(job, q, structuredClone(files), customInput).then(result => {
      if (mode === 'submit') result.attempt = this.store.recordAttempt(key, result, { codeFiles: files, assisted, requestId, elapsedMs });
      if (mode === 'reference' && result.status === 'AC') {
        this.store.transaction(() => this.store.db.run('UPDATE questions SET quality=? WHERE key=?', ['validated', key]));
        result.message = '参考解通过；正式发布仍需人工复核和已知错误解检查。';
      }
      job.result = result; job.status = 'finished';
    }).catch(error => {
      job.result = { status: error.code === 'ENV_ERROR' ? 'ENV_ERROR' : 'JUDGE_ERROR', message: error.message, caseResults: [], score: 0, maxScore: 100 };
      if (mode === 'submit') job.result.attempt = this.store.recordAttempt(key, job.result, { codeFiles: files, assisted, requestId, elapsedMs });
      job.status = 'finished';
    }).finally(() => { this.active = null; job.process = null; this.store.transaction(() => this.store.db.run('DELETE FROM meta WHERE key=?', ['pending-job:' + job.id])); this.trim(); });
    return this.snapshot(job.id);
  }
  trim() { const old = [...this.jobs.values()].filter(j => j.status === 'finished'); for (const j of old.slice(0, -25)) this.jobs.delete(j.id); }
  snapshot(id) { const job = this.jobs.get(id); ensure(job, '运行任务不存在', 'NOT_FOUND'); const { process, ...publicJob } = job; return publicJob; }
  cancel(id) { const job = this.jobs.get(id); ensure(job, '运行任务不存在'); job.cancel = true; job.process?.stop('cancel'); return true; }
  async execute(job, q, drafts, customInput) {
    job.status = 'preparing';
    const e = q.execution, runtime = await this.environments.resolve(e.runtime_ref, q.bankId), settings = this.store.getSettings();
    if (q.type === 'rtl') ensure(runtime.kind === 'rtl', 'RTL 题需要 HDL 仿真环境', 'ENV_ERROR');
    else ensure(runtime.kind !== 'rtl', '软件编程题不能使用 HDL 环境', 'ENV_ERROR');
    const limits = { ...e.limits, memory_mib: Math.min(e.limits.memory_mib, settings.maxMemoryMiB), job_wall_ms: Math.min(e.limits.job_wall_ms, settings.maxJobWallMs),
      per_case_wall_ms: Math.min(e.limits.per_case_wall_ms, 60000), compile_wall_ms: Math.min(e.limits.compile_wall_ms, 120000),
      output_kib: Math.min(e.limits.output_kib, 1024), artifact_mib: Math.min(e.limits.artifact_mib, 20), processes: Math.min(e.limits.processes, 64) };
    const cwd = path.join(this.jobsRoot, job.id);
    fs.mkdirSync(cwd, { recursive: true, mode: 0o777 });
    const mappings = job.mode === 'reference' ? e.reference_files : e.starter_files;
    for (const m of [...mappings, ...e.judge.testbench_files ?? []]) {
      const source = q.files[m.source_path];
      ensure(source, '题目缺少代码附件', 'JUDGE_ERROR');
      const value = job.mode !== 'reference' && Object.hasOwn(drafts, m.target_path) ? drafts[m.target_path] : source.content ?? source._text;
      ensure(typeof value === 'string', '无法读取代码文本附件', 'JUDGE_ERROR');
      const file = within(cwd, m.target_path); fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o777 }); fs.writeFileSync(file, value, { mode: 0o666 });
    }
    const began = Date.now(), artifacts = [];
    let canceledDockerName = null;
    const invoke = async (program, args, timeout, input = '', compile = false) => {
      if (job.cancel) return { code: null, stdout: '', stderr: '', reason: 'cancel', wallMs: 0 };
      const remaining = limits.job_wall_ms - (Date.now() - began);
      if (remaining <= 0) return { code: null, stdout: '', stderr: '整任务超时', reason: 'timeout', wallMs: 0 };
      let exe = program, argv = args;
      if (runtime.backend === 'docker') {
        ensure(!cwd.includes(','), '容器工作目录不能包含逗号', 'ENV_ERROR');
        const name = 'tp-' + uid(); canceledDockerName = name;
        exe = runtime.executable;
        argv = ['run', '--rm', '--name', name, '--network', 'none', '--memory', (compile ? Math.min(e.limits.compile_memory_mib, 2048) : limits.memory_mib) + 'm',
          '--memory-swap', (compile ? Math.min(e.limits.compile_memory_mib, 2048) : limits.memory_mib) + 'm', '--cpus', '1', '--pids-limit', String(limits.processes),
          '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true', '--read-only', '--user', '65534:65534', '--tmpfs', '/tmp:rw,noexec,nosuid,size=64m',
          '--mount', `type=bind,source=${cwd},target=/work`, '--workdir', '/work', '--interactive', runtime.imageId, program, ...args];
      }
      const outcome = await command(exe, argv, { cwd, input, timeout: Math.min(timeout, remaining), outputLimit: limits.output_kib * 1024,
        onProcess: handle => { job.process = handle; }, onOutput: text => { job.logs = (job.logs + text).slice(-60000); } });
      if ((outcome.reason || job.cancel) && runtime.backend === 'docker' && canceledDockerName) await command(runtime.executable, ['rm', '-f', canceledDockerName], { timeout: 5000 });
      canceledDockerName = null; job.process = null;
      if (runtime.backend === 'docker' && outcome.code === 125) throw new AppError('容器启动失败：' + outcome.stderr.slice(-500), 'ENV_ERROR');
      if (job.cancel) outcome.reason = 'cancel';
      return outcome;
    };
    const makeResult = (status, cases, compile = null, message = '') => ({ status, score: status === 'AC' ? 100 : cases.length ? Math.round(cases.filter(c => c.status === 'AC').length * 10000 / cases.length) / 100 : 0,
      maxScore: 100, caseResults: cases, compile, message, runtimeLock: { id: runtime.id, backend: runtime.backend, version: runtime.version, adapterVersion: runtime.adapterVersion },
      testHash: hash(e.judge), limits, wallMs: Date.now() - began, artifacts, nativeLimits: runtime.backend === 'native' ? '本机模式控制超时和输出大小；不提供严格的内存、进程与文件隔离。' : null });
    let compile = null, runProgram, runArgs = [];
    const sourceTargets = mappings.map(m => m.target_path), isWindowsNative = process.platform === 'win32' && runtime.backend === 'native';
    const binary = isWindowsNative ? 'solution.exe' : 'solution';
    if (runtime.kind === 'c' || runtime.kind === 'cpp') {
      job.status = 'compiling';
      compile = await invoke(runtime.backend === 'native' ? runtime.executable : runtime.kind === 'c' ? 'gcc' : 'g++',
        ['-std=' + (runtime.kind === 'c' ? 'c11' : 'c++17'), '-O2', '-Wall', ...sourceTargets.filter(s => /\.(c|cc|cpp|cxx)$/i.test(s)), '-o', binary], limits.compile_wall_ms, '', true);
      runProgram = runtime.backend === 'native' ? path.join(cwd, binary) : './' + binary;
    } else if (runtime.kind === 'rtl') {
      job.status = 'compiling';
      compile = await invoke(runtime.backend === 'native' ? runtime.executable : 'iverilog', ['-g2005', '-s', e.judge.top_module, '-o', 'simulation.vvp', ...sourceTargets, ...e.judge.testbench_files.map(m => m.target_path)], limits.compile_wall_ms, '', true);
      runProgram = runtime.backend === 'native' ? runtime.vvp : 'vvp'; runArgs = ['simulation.vvp'];
    } else { runProgram = runtime.backend === 'native' ? runtime.executable : 'python'; runArgs = ['-I', '-B', e.entry_file]; }
    if (compile && (compile.code !== 0 || compile.reason)) {
      const status = failureStatus(compile, job.mode === 'reference' ? 'JUDGE_ERROR' : 'CE');
      return makeResult(status, [], compile, status === 'CE' ? '代码编译未通过' : '编译阶段未完成');
    }
    job.status = 'running';
    const cases = runtime.kind === 'rtl' ? [{ id: 'hdl_checks', visibility: 'private' }] : customInput !== null && job.mode === 'sample'
      ? [{ id: 'custom_input', visibility: 'sample', stdin: customInput, expected_stdout: null }]
      : e.judge.tests.filter(c => job.mode !== 'sample' || c.visibility === 'sample');
    const caseResults = [];
    for (const testcase of cases) {
      const result = await invoke(runProgram, runArgs, runtime.kind === 'rtl' ? limits.job_wall_ms : limits.per_case_wall_ms, testcase.stdin ?? '');
      let status = result.reason || result.code !== 0 ? failureStatus(result, 'RE') : 'AC';
      let checkCount = null;
      if (status === 'AC' && runtime.kind === 'rtl') {
        const done = [...result.stdout.matchAll(/^QB_TEST_DONE checks=(\d+)\s*$/gm)];
        checkCount = done.length === 1 ? Number(done[0][1]) : 0;
        if (checkCount !== e.judge.check_count) status = 'JUDGE_ERROR';
        if (/QB_CHECK_FAIL/.test(result.stdout)) status = 'WA';
      } else if (runtime.kind === 'rtl' && /QB_CHECK_FAIL/.test(result.stdout) && !result.reason) status = 'WA';
      if (status === 'AC' && runtime.kind !== 'rtl' && testcase.expected_stdout !== null && !compareOutput(result.stdout, testcase.expected_stdout, e.judge.comparator)) status = 'WA';
      if (job.mode === 'reference' && status !== 'AC' && status !== 'CANCELED') status = 'JUDGE_ERROR';
      const detail = { id: testcase.id, visibility: testcase.visibility, status, stdout: result.stdout, stderr: result.stderr, expected: testcase.expected_stdout ?? null,
        input: testcase.stdin ?? null, wallMs: result.wallMs, exitCode: result.code, checkCount };
      caseResults.push(detail); job.caseResults = [...caseResults];
      if (['CANCELED', 'JUDGE_ERROR'].includes(status)) break;
    }
    const wave = path.join(cwd, 'wave.vcd');
    if (runtime.kind === 'rtl' && fs.existsSync(wave) && fs.lstatSync(wave).isFile() && !fs.lstatSync(wave).isSymbolicLink()) {
      const size = fs.statSync(wave).size;
      if (size <= limits.artifact_mib * 1024 * 1024) {
        const target = path.join(this.store.dataDir, 'artifacts', job.id, 'wave.vcd');
        fs.mkdirSync(path.dirname(target), { recursive: true }); fs.copyFileSync(wave, target);
        artifacts.push({ jobId: job.id, name: 'wave.vcd', size });
      } else job.logs += '\n波形产物超过上限，未收集。';
    }
    const status = caseResults.some(c => c.status === 'CANCELED') ? 'CANCELED' : caseResults.find(c => c.status !== 'AC')?.status ?? 'AC';
    return makeResult(status, caseResults, compile, job.mode === 'sample' ? '这是调试运行，不计入正式学习记录。' : '');
  }
}
function failureStatus(result, fallback) {
  if (result.reason === 'cancel') return 'CANCELED';
  if (result.reason === 'timeout') return 'TLE';
  if (result.reason === 'output') return 'OLE';
  if (result.reason === 'spawn') return 'ENV_ERROR';
  if (result.code === 137) return 'MLE';
  return fallback;
}
