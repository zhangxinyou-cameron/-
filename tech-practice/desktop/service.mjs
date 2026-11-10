import fs from 'node:fs';
import path from 'node:path';
import { Store } from './store.mjs';
import { QBankValidator } from './qbank.mjs';
import { Environments } from './environment.mjs';
import { Runner } from './runner.mjs';
import { Backups } from './backup.mjs';
import { ensure, uid } from './util.mjs';
import { Plugins } from './plugins/index.mjs';

export async function createServices(root, assetDir, { onProgress = () => {}, updater = null } = {}) {
  await onProgress(12, '读取你的学习记录');
  const store = await new Store(path.join(root, 'state'), path.join(assetDir, 'sql-wasm.wasm')).init();
  await onProgress(35, '学习记录已就绪');
  const validator = new QBankValidator(JSON.parse(fs.readFileSync(path.join(assetDir, 'qbank.schema.json'), 'utf8')));
  await onProgress(46, '整理你的题库');
  if (!store.one('SELECT value FROM meta WHERE key=?', ['seeded'])) {
    const seeds = JSON.parse(fs.readFileSync(path.join(assetDir, 'starter-banks.json'), 'utf8'));
    for (const seed of seeds) {
      const checked = validator.validate(seed); ensure(checked.valid, '内置题库校验失败', 'E_SEED', checked.errors);
      store.importBank(checked.bank);
    }
    store.transaction(() => store.db.run('INSERT INTO meta VALUES(?,?)', ['seeded', '1']));
  }
  await onProgress(62, '题库已就绪');
  const environments = new Environments(store, assetDir, path.join(root, 'environments'));
  const runner = new Runner(store, environments, path.join(root, 'jobs'));
  const backups = new Backups(store, path.join(root, 'backups'));
  await onProgress(70, '恢复上次练习状态');
  // A stopped application never turns an unfinished evaluation into a wrong answer.
  for (const row of store.all("SELECT key,value FROM meta WHERE key LIKE 'pending-job:%'")) {
    const pending = JSON.parse(row.value);
    if (pending.mode === 'submit') store.recordAttempt(pending.key, { status: 'CANCELED', score: 0, maxScore: 100, message: '上次运行中断，可重新提交', caseResults: [] }, pending);
    store.transaction(() => store.db.run('DELETE FROM meta WHERE key=?', [row.key]));
  }
  await onProgress(78, '检查本地学习备份');
  try { backups.automatic(); } catch (error) { console.error('Automatic backup:', error.message); }
  await onProgress(86, '准备练习工作台');
  const plugins = new Plugins({store,validator,updater}); plugins.start();
  return { root, assetDir, store, validator, environments, runner, backups, plugins };
}

export function gradeObjective(question, answer) {
  let correct;
  if (question.type === 'single_choice') {
    ensure(typeof answer === 'string' && question.answer.options.some(o => o.id === answer), '请先选择一个有效选项');
    correct = question.answer.correct_option_id === answer;
  } else if (question.type === 'multiple_choice') {
    ensure(Array.isArray(answer) && answer.length && new Set(answer).size === answer.length && answer.every(id => question.answer.options.some(o => o.id === id)), '请至少选择一个有效选项');
    correct = JSON.stringify([...answer].sort()) === JSON.stringify([...question.answer.correct_option_ids].sort());
  } else if (question.type === 'true_false') {
    ensure(typeof answer === 'boolean', '请先选择正确或错误'); correct = question.answer.correct === answer;
  } else throw new Error('此题型暂不支持客观判分');
  return { status: correct ? 'AC' : 'WA', score: correct ? 1 : 0, maxScore: 1,
    correctAnswer: question.answer.correct_option_id ?? question.answer.correct_option_ids ?? question.answer.correct, caseResults: [] };
}
