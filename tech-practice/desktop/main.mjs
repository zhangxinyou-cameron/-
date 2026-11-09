import { app, BrowserWindow, clipboard, dialog, ipcMain, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { createServices, gradeObjective } from './service.mjs';
import { AppError, atomicWrite, ensure, hash, uid, within, localDay, strictJSON } from './util.mjs';
import { exportBank } from './qbank.mjs';
import AdmZip from 'adm-zip';
import { nextStartupQuote } from './startup.mjs';

app.setName('TechPractice');
if (process.platform === 'win32') app.setAppUserModelId('local.techpractice.desktop');
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();
let window, splash, services, closing = false, pluginEditorDirty = false;
let startupState = { progress: 0, message: '正在开启你的学习空间', quote: '', version: app.getVersion(), error: null, leaving: false };
let rendererReady = false, mainLoaded = false, startupFinished = false, startupStartedAt = 0, startupWatchdog, startupTransition;
const hiddenTest = process.env.TECH_PRACTICE_TEST === '1';
const startupEvents = [];
if (hiddenTest) globalThis.__startupEvents = startupEvents;

function publishStartup(progress, message, extra = {}) {
  startupState = { ...startupState, progress: Math.max(startupState.progress, progress), message, ...extra };
  startupEvents.push({ ...startupState, at: Date.now() });
  if (splash && !splash.isDestroyed()) splash.webContents.send('startup:progress', startupState);
}
function failStartup(error) {
  if (closing || startupFinished || startupState.error) return;
  clearTimeout(startupWatchdog); clearTimeout(startupTransition);
  console.error('Startup:', error);
  const message = String(error?.message ?? error).slice(0, 500);
  publishStartup(startupState.progress, '启动遇到一点问题', { error: message });
  if (splash && !splash.isDestroyed()) { if (!hiddenTest) { splash.show(); splash.focus(); } }
  else { dialog.showErrorBox('知习启动失败', message); app.quit(); }
}
function finishStartup() {
  if (!rendererReady || !mainLoaded || startupFinished || startupState.error || closing) return;
  startupFinished = true; clearTimeout(startupWatchdog);
  publishStartup(100, '一切就绪，开始今天的进步');
  // Progress has already reached 100% on real renderer readiness. This short
  // presentation interval only gives the completed animation time to settle.
  const remaining = Math.max(0, 1600 - (Date.now() - startupStartedAt));
  startupTransition = setTimeout(() => {
    if (closing || !window || window.isDestroyed()) return;
    publishStartup(100, '一切就绪，开始今天的进步', { leaving: true });
    startupTransition = setTimeout(() => {
      if (closing || !window || window.isDestroyed()) return;
      if (!hiddenTest) { window.show(); window.focus(); }
      if (splash && !splash.isDestroyed()) splash.destroy();
      splash = null;
    }, 220);
  }, remaining);
}
const fromSplash = event => splash && !splash.isDestroyed() && event.sender === splash.webContents && event.senderFrame === splash.webContents.mainFrame;
ipcMain.handle('startup:snapshot', event => { ensure(fromSplash(event), '只允许启动窗口读取', 'FORBIDDEN'); return startupState; });
ipcMain.on('startup:exit', event => { if (fromSplash(event)) { closing = true; app.quit(); } });
ipcMain.on('startup:retry', event => { if (fromSplash(event) && startupState.error) { closing = true; app.relaunch(); app.exit(0); } });
ipcMain.on('practice:ready', event => {
  if (window && event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame) { rendererReady = true; finishStartup(); }
});
ipcMain.on('practice:startup-failed', (event, message) => {
  if (window && event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame && typeof message === 'string') failStartup(new Error(message));
});
const previews = new Map();
const safeName = value => String(value).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 80);
const previewResponse = checked => {
  if (!checked.valid) return { valid: false, errors: checked.errors, warnings: checked.warnings };
  const token = uid(); previews.set(token, { bank: checked.bank, at: Date.now() });
  for (const [key, value] of previews) if (Date.now() - value.at > 30 * 60000) previews.delete(key);
  return { valid: true, token, errors: [], warnings: checked.warnings, preview: services.store.previewImport(checked.bank) };
};

async function makeWindow() {
  const root = process.env.TECH_PRACTICE_DATA_DIR || app.getPath('userData');
  const assetDir = path.join(app.getAppPath(), 'assets');
  startupStartedAt = Date.now();
  startupState.quote = nextStartupQuote(root).text;
  splash = new BrowserWindow({ title: '知习 · 正在开启', width: 760, height: 490, useContentSize: true, frame: false,
    resizable: false, maximizable: false, show: false, backgroundColor: '#112228', icon: path.join(assetDir, 'icon.ico'),
    webPreferences: { preload: path.join(app.getAppPath(), 'build', 'startup-preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, backgroundThrottling: false } });
  splash.setMenuBarVisibility(false);
  splash.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  splash.webContents.on('will-navigate', event => event.preventDefault());
  splash.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  splash.on('close', () => { closing = true; app.quit(); });
  await splash.loadFile(path.join(app.getAppPath(), 'build', 'startup', 'index.html'));
  if (!hiddenTest) splash.show();
  publishStartup(6, '正在开启你的学习空间');
  startupWatchdog = setTimeout(() => failStartup(new Error('启动等待时间较长，请重试。若问题持续，请检查学习数据目录是否可访问。')), 45000);
  startupWatchdog.unref();
  services = await createServices(root, assetDir, { onProgress: async (percent, message) => {
    publishStartup(percent, message); await new Promise(resolve => setImmediate(resolve));
  } });
  if (closing) return;
  if (hiddenTest) globalThis.__practiceServices = services;
  window = new BrowserWindow({ title: '知习 · 技术练习室', width: 1460, height: 960, minWidth: 1040, minHeight: 700,
    show: false, backgroundColor: '#f5f7fa', icon: path.join(assetDir, 'icon.ico'),
    webPreferences: { preload: path.join(app.getAppPath(), 'build', 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, spellcheck: false, backgroundThrottling: false } });
  window.setMenuBarVisibility(false);
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.on('render-process-gone', (_event, details) => failStartup(new Error('工作台加载中断：' + details.reason)));
  window.webContents.on('did-fail-load', (_event, code, description, _url, isMainFrame) => { if (isMainFrame && code !== -3) failStartup(new Error(description)); });
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  window.on('close', event => {
    if(pluginEditorDirty&&!closing){const choice=dialog.showMessageBoxSync(window,{type:'question',buttons:['继续编辑','放弃未保存修改并退出'],defaultId:0,cancelId:0,message:'学习内容尚未保存'});if(choice===0){event.preventDefault();return;}}
    if (services.runner.active && !closing) {
      const choice = dialog.showMessageBoxSync(window, { type: 'question', buttons: ['继续练习', '停止运行并退出'], defaultId: 0, cancelId: 0, message: '仍有代码任务正在运行', detail: '退出会停止本次运行，草稿会保留。' });
      if (choice === 0) { event.preventDefault(); return; }
      services.runner.cancel(services.runner.active.id);
    }
    services.store.save();
  });
  await window.loadFile(path.join(app.getAppPath(), 'dist', 'index.html'));
  mainLoaded = true;
  publishStartup(94, '载入你的练习工作台');
  finishStartup();
}

const methods = {
  learningExample:()=>{ensure(services.plugins.enabled('learning'),'插件已关闭');return JSON.parse(fs.readFileSync(path.join(services.assetDir,'learnpack-demo.json'),'utf8'));},
  plugins:()=>services.plugins.list(),
  togglePlugin:({id,enabled})=>{ensure(!pluginEditorDirty,'请先保存学习编辑内容');return services.plugins.toggle(id,enabled);},
  plugin:({id,action,payload})=>services.plugins.call(id,action,payload),
  pluginDirty:({dirty})=>{ensure(typeof dirty==='boolean','无效编辑状态');pluginEditorDirty=dirty;return true;},
  confirmNavigation:async()=>{if(!pluginEditorDirty)return true;const r=await dialog.showMessageBox(window,{type:'question',buttons:['继续编辑','放弃未保存修改'],defaultId:0,cancelId:0,message:'学习内容尚未保存，是否离开？'});if(r.response===1){pluginEditorDirty=false;return true;}return false;},
  importLearning:async()=>{ensure(services.plugins.enabled('learning'),'插件已关闭');const r=await dialog.showOpenDialog(window,{title:'导入学习课程 LearnPack',properties:['openFile'],filters:[{name:'LearnPack JSON',extensions:['json']}]});if(r.canceled)return null;ensure(fs.statSync(r.filePaths[0]).size<=8*1024*1024,'课程超过 8 MiB');return services.plugins.call('learning','import',{pack:strictJSON(fs.readFileSync(r.filePaths[0],'utf8'),8*1024*1024)});},
  exportLearning:async({id})=>{const p=services.plugins.call('learning','export',{id});const r=await dialog.showSaveDialog(window,{title:'导出学习课程',defaultPath:'learning-course.json',filters:[{name:'LearnPack JSON',extensions:['json']}]});if(r.canceled)return null;atomicWrite(r.filePath,JSON.stringify(p,null,2));return true;},
  bootstrap: () => ({ overview: services.store.overview(), settings: services.store.getSettings(), version: app.getVersion(),
    dataDirectory: services.root, plugins: services.plugins.list(), banks: services.store.listBanks().map(b => ({ ...b, trusted: services.store.getSettings().trustedBanks.includes(b.id + ':' + hash(services.store.bank(b.id))) })) }),
  questions: params => services.store.listQuestions(params),
  question: ({ key }) => services.store.question(key),
  saveDraft: ({ key, draft }) => services.store.saveDraft(key, draft),
  annotate: ({ identity, patch }) => services.store.annotate(identity, { ...(Object.hasOwn(patch, 'note') ? { note: patch.note } : {}), ...(Object.hasOwn(patch, 'bookmarked') ? { bookmarked: patch.bookmarked } : {}), ...(Object.hasOwn(patch, 'collection') ? { collection: patch.collection } : {}) }),
  reviewAction: ({ key, action, reason }) => services.store.reviewAction(key, action, reason),
  startSession: ({ keys, mode, seed }) => services.store.startSession(keys, mode, seed),
  moveSession: ({ id, index }) => services.store.moveSession(id, index),
  submitObjective: ({ key, answer, assisted, requestId, elapsedMs }) => {
    const q = services.store.question(key); return services.store.recordAttempt(key, gradeObjective(q, answer), { answer, assisted: !!assisted, requestId, elapsedMs });
  },
  run: params => services.runner.start(params),
  job: ({ id }) => services.runner.snapshot(id),
  activeJob: () => services.runner.active ? services.runner.snapshot(services.runner.active.id) : null,
  cancel: ({ id }) => services.runner.cancel(id),
  previewText: ({ text }) => previewResponse(services.validator.fromText(text)),
  chooseImport: async () => {
    const result = await dialog.showOpenDialog(window, { title: '导入 QBank 题库', properties: ['openFile'], filters: [{ name: 'QBank 题库', extensions: ['json', 'zip'] }] });
    if (result.canceled) return null;
    try { return previewResponse(services.validator.fromFile(result.filePaths[0])); }
    catch (error) { return { valid: false, errors: [{ code: error.code ?? 'E_IMPORT', message: error.message, json_path: '$' }], warnings: [] }; }
  },
  commitImport: ({ token }) => {
    const checked = previews.get(token); ensure(checked && Date.now() - checked.at < 30 * 60000, '导入预览已过期，请重新校验');
    ensure(!services.runner.active, '代码任务运行中，请稍后导入');
    services.backups.automatic('before-import');
    const result = services.store.importBank(checked.bank); previews.delete(token); return result;
  },
  bankText: ({ id }) => {
    const bank = services.store.bank(id); ensure(!Object.values(bank.files).some(f => f.kind === 'asset'), '此题库包含二进制附件，请导出题库包后编辑');
    return JSON.stringify(bank, null, 2);
  },
  exportBank: async ({ id }) => {
    const bank = services.store.bank(id), exported = exportBank(bank);
    const result = await dialog.showSaveDialog(window, { title: '导出题库', defaultPath: safeName(bank.title) + '.' + exported.extension, filters: [{ name: '题库', extensions: [exported.extension.endsWith('zip') ? 'zip' : 'json'] }] });
    if (result.canceled || !result.filePath) return null;
    atomicWrite(result.filePath, exported.bytes); return result.filePath;
  },
  archiveBank: async ({ id, archived }) => {
    const b = services.store.bank(id);
    const result = await dialog.showMessageBox(window, { type: 'question', buttons: ['取消', archived ? '归档题库' : '恢复题库'], defaultId: 0, cancelId: 0,
      message: `${archived ? '归档' : '恢复'}「${b.title}」？`, detail: '作答历史、笔记和收藏都会保留。' });
    if (result.response !== 1) return false;
    services.store.transaction(() => services.store.db.run('UPDATE banks SET archived=? WHERE id=?', [archived ? 1 : 0, id])); return true;
  },
  resources: () => ({ schema: fs.readFileSync(path.join(services.assetDir, 'qbank.schema.json'), 'utf8'), prompt: fs.readFileSync(path.join(services.assetDir, 'AI生成题库提示词.md'), 'utf8'), demo: fs.readFileSync(path.join(services.assetDir, 'demo-bank.json'), 'utf8') }),
  exportToolkit: async () => {
    const result = await dialog.showSaveDialog(window, { title: '导出 AI 出题工具包', defaultPath: 'AI出题工具包.zip', filters: [{ name: '工具包', extensions: ['zip'] }] });
    if (result.canceled || !result.filePath) return null;
    const zip = new AdmZip();
    for (const file of ['qbank.schema.json', 'AI生成题库提示词.md', 'demo-bank.json']) zip.addFile(file, fs.readFileSync(path.join(services.assetDir, file)));
    atomicWrite(result.filePath, zip.toBuffer()); return result.filePath;
  },
  environments: ({ force } = {}) => services.environments.probe(!!force),
  environmentPlan: ({ id }) => services.environments.plan(id),
  applyEnvironment: ({ planId, hash }) => services.environments.apply(planId, hash),
  environmentInstall: () => services.environments.install,
  trustBank: async ({ id }) => {
    const bank = services.store.bank(id), token = id + ':' + hash(bank), settings = services.store.getSettings();
    if (settings.trustedBanks.includes(token)) return true;
    const result = await dialog.showMessageBox(window, { type: 'question', buttons: ['取消', '信任当前内容'], defaultId: 0, cancelId: 0,
      message: `允许在本机运行「${bank.title}」的代码与测试？`, detail: '本机模式会使用当前账户权限执行代码，仅控制超时与输出，不提供严格的内存、进程或文件隔离。外来题库建议使用容器。题库内容更新后需重新确认。' });
    if (result.response !== 1) return false;
    services.store.setSettings({ trustedBanks: [...settings.trustedBanks, token] }); return true;
  },
  chooseExecutable: async ({ kind }) => {
    ensure(['python', 'gcc', 'cpp', 'iverilog', 'vvp', 'docker'].includes(kind), '无效环境种类');
    const result = await dialog.showOpenDialog(window, { title: '选择 ' + kind + ' 可执行文件', properties: ['openFile'], filters: [{ name: '可执行文件', extensions: ['exe'] }] });
    if (result.canceled) return null;
    const settings = services.store.getSettings(); services.store.setSettings({ paths: { ...settings.paths, [kind]: result.filePaths[0] } });
    services.environments.cached = null; return result.filePaths[0];
  },
  settings: ({ patch }) => {
    const clean = Object.fromEntries(Object.entries(patch).filter(([k]) => ['backend', 'theme', 'dailyTarget', 'timeZone', 'editorFontSize', 'maxMemoryMiB', 'maxJobWallMs'].includes(k)));
    ensure(!services.runner.active, '运行中不能更改环境设置');
    return services.store.setSettings(clean);
  },
  backups: () => services.backups.list(),
  records: ({ metric = 'all', offset = 0 }) => {
    ensure(Number.isInteger(offset) && offset >= 0, '分页参数无效');
    const settings = services.store.getSettings();
    let items = services.store.all('SELECT payload FROM attempts ORDER BY created_at ASC').map(r => JSON.parse(r.payload));
    items = items.filter(a => ['AC','WA','CE','RE','TLE','MLE','OLE'].includes(a.status));
    if (metric === 'first') {
      const first = new Map(); for (const a of items) if (['single_choice','multiple_choice','true_false'].includes(a.type) && !first.has(a.bankId + '/' + a.questionId)) first.set(a.bankId + '/' + a.questionId, a);
      items = [...first.values()];
    } else if (metric === 'code') items = items.filter(a => ['code','rtl'].includes(a.type));
    else if (metric === 'wrong') items = items.filter(a => a.status !== 'AC');
    else if (metric === 'today' || /^\d{4}-\d{2}-\d{2}$/.test(metric)) items = items.filter(a => localDay(new Date(a.createdAt), settings.timeZone) === (metric === 'today' ? localDay(new Date(),settings.timeZone) : metric));
    items.reverse(); return { total: items.length, items: items.slice(offset, offset + 50) };
  },
  exportRecords: async () => {
    const result = await dialog.showSaveDialog(window, {title:'导出学习记录',defaultPath:'学习记录.csv',filters:[{name:'CSV 表格',extensions:['csv']}]});
    if (result.canceled || !result.filePath) return null;
    const escape = value => { let text = String(value ?? ''); if (/^[=+@-]/.test(text)) text = "'" + text; return '"' + text.replace(/"/g,'""') + '"'; };
    const header = ['记录ID','题目版本','题目名称','题型','状态','分数','满分','辅助完成','提交时间'];
    const rows = services.store.all('SELECT payload FROM attempts ORDER BY created_at').map(r => JSON.parse(r.payload)).map(a => [a.id,a.qkey,a.questionTitle,a.type,a.status,a.score,a.maxScore,a.assisted?'是':'否',a.createdAt]);
    atomicWrite(result.filePath,'\uFEFF'+[header,...rows].map(row=>row.map(escape).join(',')).join('\r\n')); return result.filePath;
  },
  backup: async () => {
    const result = await dialog.showSaveDialog(window, { title: '备份全部学习数据', defaultPath: '知习学习备份-' + new Date().toISOString().slice(0, 10) + '.zip', filters: [{ name: '备份', extensions: ['zip'] }] });
    if (result.canceled || !result.filePath) return null;
    return services.backups.create(result.filePath);
  },
  restore: async () => {
    ensure(!services.runner.active && services.environments.install?.status !== 'running', '请先结束运行或安装任务');
    const files = await dialog.showOpenDialog(window, { title: '选择学习数据备份', properties: ['openFile'], filters: [{ name: '备份', extensions: ['zip'] }] });
    if (files.canceled) return null;
    const inspected = services.backups.inspect(files.filePaths[0]);
    const confirm = await dialog.showMessageBox(window, { type: 'question', buttons: ['取消', '恢复备份'], defaultId: 0, cancelId: 0, message: '用备份替换当前学习数据？',
      detail: `备份时间：${inspected.manifest.createdAt}\n恢复前会自动保存当前数据。恢复后重新确认本机运行的题库信任。` });
    if (confirm.response !== 1) return null;
    return services.backups.restore(files.filePaths[0]);
  },
  openData: async () => { await shell.openPath(services.root); return true; },
  openBackups: async () => { await shell.openPath(services.backups.root); return true; },
  copy: ({ text }) => { ensure(typeof text === 'string' && text.length <= 2 * 1024 * 1024, '复制内容过大'); clipboard.writeText(text); return true; },
  openExternal: async ({ url }) => { const parsed = new URL(url); ensure(['https:', 'http:'].includes(parsed.protocol), '只允许打开网页链接'); await shell.openExternal(parsed.href); return true; },
  exportArtifact: async ({ jobId, name }) => {
    ensure(/^[0-9a-f-]{36}$/.test(jobId) && name === 'wave.vcd', '无效波形产物');
    const source = within(path.join(services.store.dataDir, 'artifacts'), jobId + '/' + name);
    ensure(fs.existsSync(source) && fs.lstatSync(source).isFile(), '波形文件不存在');
    const save = await dialog.showSaveDialog(window, { title: '保存波形文件', defaultPath: 'wave.vcd', filters: [{ name: 'VCD 波形', extensions: ['vcd'] }] });
    if (save.canceled || !save.filePath) return null;
    fs.copyFileSync(source, save.filePath); return save.filePath;
  }
};

ipcMain.handle('practice:api', async (event, method, payload) => {
  try {
    ensure(window && event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame, '只允许本应用主页面调用', 'FORBIDDEN');
    ensure(Object.hasOwn(methods, method), '未知应用接口', 'FORBIDDEN');
    ensure(Buffer.byteLength(JSON.stringify(payload ?? {}), 'utf8') <= 14 * 1024 * 1024, '请求内容过大');
    return { ok: true, value: await methods[method](payload ?? {}) };
  } catch (error) { console.error(method, error.message); return { ok: false, error: { message: error.message, code: error.code ?? 'APP_ERROR', details: error.details ?? null } }; }
});
app.on('second-instance', () => {
  const target = startupFinished && !startupState.error ? window : splash;
  if (target && !target.isDestroyed()) { if (target.isMinimized()) target.restore(); target.show(); target.focus(); }
});
if (gotLock) app.whenReady().then(makeWindow).catch(failStartup);
app.on('before-quit', () => { clearTimeout(startupWatchdog); clearTimeout(startupTransition); });
app.on('window-all-closed', () => { closing = true; app.quit(); });
