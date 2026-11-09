import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { createServices, gradeObjective } from '../desktop/service.mjs';
import { QBankValidator, exportBank, readZip } from '../desktop/qbank.mjs';
import { hash, safePath, strictJSON } from '../desktop/util.mjs';
import { command } from '../desktop/environment.mjs';
import { nextStartupQuote, startupQuotes } from '../desktop/startup.mjs';

const assets=path.resolve('assets'), testRoot=path.resolve('test-results/core');fs.mkdirSync(testRoot,{recursive:true});
const schema=JSON.parse(fs.readFileSync(path.join(assets,'qbank.schema.json'),'utf8'));
const demo=JSON.parse(fs.readFileSync(path.join(assets,'demo-bank.json'),'utf8'));
const validator=new QBankValidator(schema);
async function fixture(){return createServices(fs.mkdtempSync(path.join(testRoot,'case-')),assets)}
async function finished(runner,started){
  for(let i=0;i<400;i++){const job=runner.snapshot(started.id);if(job.status==='finished'&&!runner.active)return job;await new Promise(r=>setTimeout(r,50))}throw new Error('Runner did not finish');
}

test('spawned tool receives its own binary directory first in PATH',async()=>{
  const result=await command(process.execPath,['-e',"console.log((process.env.PATH ?? process.env.Path).split(require('node:path').delimiter)[0])"]);
  assert.equal(result.code,0,result.stderr);
  assert.equal(path.resolve(result.stdout.trim()).toLowerCase(),path.dirname(process.execPath).toLowerCase());
});

test('startup messages persist a complete no-repeat cycle across launches',()=>{
  const dir=fs.mkdtempSync(path.join(testRoot,'quotes-'));
  const first=Array.from({length:startupQuotes.length},()=>nextStartupQuote(dir));
  assert.equal(new Set(first.map(q=>q.id)).size,startupQuotes.length);
  const second=nextStartupQuote(dir);assert.notEqual(second.id,first.at(-1).id);
  assert.ok(startupQuotes.includes(second.text));
  fs.writeFileSync(path.join(dir,'startup-quotes.json'),'{broken');
  assert.ok(nextStartupQuote(dir).text);
});

test('startup completion milestones follow real initialized services and backup',async()=>{
  const steps=[];const s=await createServices(fs.mkdtempSync(path.join(testRoot,'phases-')),assets,{onProgress:(progress,message)=>steps.push({progress,message})});
  assert.deepEqual(steps.map(s=>s.progress),[12,35,46,62,70,78,86]);
  assert.ok(s.store.listBanks().length>0);assert.ok(s.backups.list().length>0);
  assert.ok(steps.every(s=>s.progress<100));
});

test('QBank rejects ambiguous JSON, wrong references, path collisions and corrupted assets',()=>{
  assert.throws(()=>strictJSON('{"schema_version":"1.0","schema_version":"2.0"}'),/重复/);
  assert.throws(()=>strictJSON('{"x":1,}'),/格式/);
  assert.equal(validator.validate(demo).valid,true);
  const bad=structuredClone(demo);bad.questions[0].answer.correct_option_id='missing';
  assert.equal(validator.validate(bad).valid,false);
  assert.ok(validator.validate(bad).errors.some(e=>e.code==='E_OPTION_REF'));
  const typo=structuredClone(demo);typo.questions[0].diffficulty=1;assert.equal(validator.validate(typo).valid,false);
  for(const name of ['../outside','a/../b','C:/x','a\\b','CON.txt','folder. /x','a//b','a/./b'])assert.equal(safePath(name),false,name);
  const collision=structuredClone(demo);collision.files['RTL/starter/top_module.v']=collision.files['rtl/starter/top_module.v'];assert.equal(validator.validate(collision).valid,false);
  const attachment=structuredClone(demo);attachment.files['diagram.png']={kind:'asset',role:'asset',package_path:'assets/a.png',sha256:'0'.repeat(64)};
  assert.ok(validator.validate(attachment,new Map([['assets/a.png',Buffer.from('x')]])).errors.some(e=>e.code==='E_ASSET_HASH'));
});
test('ZIP and JSON export round trip without losing original code',()=>{
  const zip=new AdmZip();zip.addFile('bank.json',Buffer.from(JSON.stringify(demo)));const entries=readZip(zip.toBuffer());
  const checked=validator.validate(strictJSON(entries.get('bank.json').toString()));assert.equal(checked.valid,true);
  const round=exportBank(checked.bank);assert.deepEqual(JSON.parse(round.bytes.toString()),demo);
});
test('single, multiple and false answers are judged strictly; unanswered is not false',()=>{
  assert.equal(gradeObjective(demo.questions[0],'opt_b').status,'AC');
  assert.equal(gradeObjective(demo.questions[1],['opt_c','opt_a']).status,'AC');
  assert.equal(gradeObjective(demo.questions[1],['opt_a']).status,'WA');
  assert.equal(gradeObjective(demo.questions[2],false).status,'AC');
  assert.throws(()=>gradeObjective(demo.questions[2],null),/先选择/);
  assert.throws(()=>gradeObjective(demo.questions[2],'false'),/先选择/);
});
test('imports are idempotent, conflicts are atomic, revisions keep history and notes',async()=>{
  const s=await fixture();let bank=validator.validate(demo).bank;s.store.importBank(bank);
  const key=bank.bank_id+'/'+bank.questions[0].id+'@1';
  const a=s.store.recordAttempt(key,gradeObjective(bank.questions[0],'opt_a'),{answer:'opt_a',requestId:'dedupe-test'});
  assert.equal(s.store.recordAttempt(key,{status:'AC'},{requestId:'dedupe-test'}).id,a.id);
  s.store.annotate(bank.bank_id+'/'+bank.questions[0].id,{note:'保留这条笔记',bookmarked:true});
  assert.equal(s.store.previewImport(bank).counts.unchanged,7);
  const conflict=structuredClone(bank);conflict.questions[0].title='不同内容';
  assert.throws(()=>s.store.importBank(conflict),/冲突/);
  assert.equal(s.store.question(key).title,bank.questions[0].title);
  conflict.questions[0].revision=2;conflict.bank_version='1.1.0';s.store.importBank(conflict);
  assert.equal(s.store.question(key).attempts[0].status,'WA');
  assert.equal(s.store.question(bank.bank_id+'/'+bank.questions[0].id+'@2').annotation.note,'保留这条笔记');
  assert.equal(s.store.listQuestions({bankId:bank.bank_id})[0].attemptCount,0);
  s.store.db.close();
});
test('wrong answers schedule review; assisted success and environment errors do not inflate mastery',async()=>{
  const s=await fixture();const q=s.store.listQuestions().find(q=>q.type==='true_false');
  s.store.recordAttempt(q.key,{status:'WA',score:0,maxScore:1});
  let meta=s.store.listQuestions().find(x=>x.key===q.key);assert.equal(meta.wrong,true);assert.equal(meta.stage,0);
  s.store.recordAttempt(q.key,{status:'AC',score:1,maxScore:1},{assisted:true});
  meta=s.store.listQuestions().find(x=>x.key===q.key);assert.equal(meta.stage,0);assert.equal(meta.corrected,false);
  s.store.recordAttempt(q.key,{status:'AC',score:1,maxScore:1},{assisted:false});
  meta=s.store.listQuestions().find(x=>x.key===q.key);assert.equal(meta.stage,1);assert.equal(meta.corrected,true);
  s.store.recordAttempt(q.key,{status:'AC',score:1,maxScore:1},{assisted:false});
  assert.equal(s.store.listQuestions().find(x=>x.key===q.key).stage,1);
  const count=s.store.overview().totalAttempts;s.store.recordAttempt(q.key,{status:'ENV_ERROR',score:0,maxScore:1});
  assert.equal(s.store.overview().totalAttempts,count);s.store.db.close();
});
test('backup restores database, notes and drafts; corrupted backup is rejected',async()=>{
  const s=await fixture(),q=s.store.listQuestions()[0];
  s.store.annotate(q.bankId+'/'+q.id,{note:'恢复前的笔记'});s.store.saveDraft(q.key,{answer:'opt_a',files:{}});
  const file=path.join(s.root,'backup.zip');s.backups.create(file);
  s.store.annotate(q.bankId+'/'+q.id,{note:'后续修改'});s.backups.restore(file);
  assert.equal(s.store.question(q.key).annotation.note,'恢复前的笔记');assert.equal(s.store.draft(q.key).answer,'opt_a');assert.equal(s.store.getSettings().backend,'docker');
  const bad=new AdmZip(file);bad.updateFile('learning.sqlite',Buffer.from('not a database'));const badFile=path.join(s.root,'corrupt.zip');bad.writeZip(badFile);
  assert.throws(()=>s.backups.inspect(badFile),/摘要/);s.store.db.close();
});
test('Python runs real sample and private cases; sample is not a formal attempt',async()=>{
  const s=await fixture(),meta=s.store.listQuestions().find(q=>q.id==='sum_all_integers'),q=s.store.question(meta.key);
  s.store.setSettings({backend:'native',trustedBanks:[q.bankId+':'+hash(s.store.bank(q.bankId))]});
  const files={'main.py':q.files[q.execution.reference_files[0].source_path].content};
  const sample=await finished(s.runner,s.runner.start({key:q.key,mode:'sample',files}));
  assert.equal(sample.result.status,'AC');assert.equal(sample.result.caseResults.length,1);assert.equal(s.store.question(q.key).attempts.length,0);
  const formal=await finished(s.runner,s.runner.start({key:q.key,mode:'submit',files,requestId:'python-formal'}));
  assert.equal(formal.result.status,'AC');assert.equal(formal.result.caseResults.length,4);assert.equal(s.store.question(q.key).attempts.length,1);
  const wrong=await finished(s.runner,s.runner.start({key:q.key,mode:'submit',files:{'main.py':'print(123)\n'}}));assert.equal(wrong.result.status,'WA');
  const lock=s.store.all('SELECT * FROM runtime_locks');assert.ok(lock[0].id.length===64);
  s.store.db.close();
});
test('missing backend and untrusted native bank never count as wrong answers',async()=>{
  const s=await fixture(),q=s.store.listQuestions().find(q=>q.id==='sum_all_integers');
  s.store.setSettings({backend:'native',trustedBanks:[]});
  const result=await finished(s.runner,s.runner.start({key:q.key,mode:'submit',files:{'main.py':'print(1)'}}));
  assert.equal(result.result.status,'ENV_ERROR');assert.equal(s.store.overview().totalAttempts,0);assert.equal(s.store.listQuestions().find(x=>x.key===q.key).wrong,false);s.store.db.close();
});
test('a running Python process can be canceled without creating a wrong answer',async()=>{
  const s=await fixture(),q=s.store.listQuestions().find(q=>q.id==='sum_all_integers');
  s.store.setSettings({backend:'native',trustedBanks:[q.bankId+':'+hash(s.store.bank(q.bankId))]});
  const job=s.runner.start({key:q.key,mode:'submit',files:{'main.py':'while True:\n    pass\n'}});
  await new Promise(r=>setTimeout(r,300));s.runner.cancel(job.id);
  const result=await finished(s.runner,job);assert.equal(result.result.status,'CANCELED');assert.equal(s.store.overview().totalAttempts,0);s.store.db.close();
});
test('timeout and output limits terminate real Python programs and classify the result',async()=>{
  const s=await fixture();let bank=s.store.bank('python-fundamentals');const question=bank.questions.find(q=>q.id==='sum_all_integers');
  question.revision=2;question.execution.limits.per_case_wall_ms=250;question.execution.limits.job_wall_ms=1500;question.execution.limits.output_kib=1;bank.bank_version='1.0.1';s.store.importBank(bank);
  const q=s.store.listQuestions().find(q=>q.id==='sum_all_integers');s.store.setSettings({backend:'native',trustedBanks:[q.bankId+':'+hash(s.store.bank(q.bankId))]});
  let job=await finished(s.runner,s.runner.start({key:q.key,mode:'submit',files:{'main.py':'while True:\n    pass\n'}}));assert.equal(job.result.status,'TLE');
  job=await finished(s.runner,s.runner.start({key:q.key,mode:'submit',files:{'main.py':"print('x' * 50000)\n"}}));assert.equal(job.result.status,'OLE');assert.ok(job.logs.length<60001);
  s.store.db.close();
});
test('a persisted interrupted submission is recovered as canceled after restart',async()=>{
  const s=await fixture(),q=s.store.listQuestions().find(q=>q.id==='sum_all_integers');
  s.store.transaction(()=>s.store.db.run('INSERT INTO meta VALUES(?,?)',['pending-job:recovery',JSON.stringify({key:q.key,mode:'submit',codeFiles:{'main.py':'print(1)'},requestId:'interrupted-test'})]));
  s.store.db.close();const recovered=await createServices(s.root,assets);
  assert.equal(recovered.store.question(q.key).attempts[0].status,'CANCELED');assert.equal(recovered.store.overview().totalAttempts,0);assert.equal(recovered.store.all("SELECT * FROM meta WHERE key LIKE 'pending-job:%'").length,0);
  recovered.store.db.close();
});
test('a valid backup can restore a SQLite database larger than the bank text limit',async()=>{
  const s=await fixture();
  s.store.transaction(()=>{s.store.db.run('CREATE TABLE large_backup_fixture(data BLOB)');s.store.db.run('INSERT INTO large_backup_fixture VALUES(zeroblob(11534336))')});
  const file=path.join(s.root,'large.zip');s.backups.create(file);
  assert.ok(s.backups.inspect(file).entries.get('learning.sqlite').length>10*1024*1024);
  s.backups.restore(file);assert.equal(s.store.one('SELECT length(data) n FROM large_backup_fixture').n,11534336);
  s.store.db.close();
});
