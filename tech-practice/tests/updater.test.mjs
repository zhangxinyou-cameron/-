import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {Updater,runCommand,validateInstallPlan} from '../desktop/updater.mjs';
const git=process.platform==='win32'?'C:/Program Files/Git/cmd/git.exe':'git';
const base=path.resolve('test-results/updater');fs.mkdirSync(base,{recursive:true});
const write=(p,s)=>{fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,s)};
async function fixture(){
 const root=fs.mkdtempSync(path.join(base,'case-')),seed=path.join(root,'seed'),repo=path.join(root,'repo'),remote=path.join(root,'remote.git');fs.mkdirSync(seed);
 const g=(args,cwd=seed)=>runCommand(git,args,{cwd});
 await g(['init','--initial-branch=master']);await g(['config','user.name','Updater Test']);await g(['config','user.email','test@example.invalid']);
 write(path.join(seed,'.gitignore'),'tech-practice/release/\ntech-practice/node_modules/\n');write(path.join(seed,'tech-practice/package.json'),'{}');write(path.join(seed,'content.txt'),'first');
 await g(['add','.']);await g(['commit','-m','first']);const first=await g(['rev-parse','HEAD']);
 await g(['init','--bare',remote]);await g(['remote','add','origin',remote]);await g(['push','origin','master','master:main']);await g(['clone',remote,repo]);
 write(path.join(seed,'content.txt'),'second');await g(['add','.']);await g(['commit','-m','second']);await g(['push','origin','master:main']);const second=await g(['rev-parse','HEAD']);
 const appPath=path.join(repo,'tech-practice/release/TechPractice-win32-x64/resources/app');write(path.join(appPath,'package.json'),'{}');write(path.resolve(appPath,'../../TechPractice.exe'),'old');
 let backups=0,installed=null;
 const updater=new Updater({appPath,dataDir:path.join(root,'data'),git,remotes:[remote],buildCommit:first,backup:()=>backups++,restart:p=>{installed=p},build:async({stage,commit})=>{write(path.join(stage,'TechPractice.exe'),'new');write(path.join(stage,'resources/app/package.json'),'{}');write(path.join(stage,'resources/app/build-info.json'),JSON.stringify({commit}));}});
 return {root,repo,seed,remote,first,second,updater,g,backups:()=>backups,installed:()=>installed};
}
test('real Git detects commit without version bump, fast-forwards source, stages app and installs only when ready',async()=>{
 const f=await fixture();assert.equal((await f.updater.check()).status,'available');assert.equal(f.updater.snapshot().remoteCommit,f.second);
 assert.equal((await f.updater.start()).status,'updating');await assert.rejects(()=>f.updater.start(),/先检查/);await f.updater.task;
 assert.equal(f.updater.snapshot().status,'ready');assert.equal(await f.g(['rev-parse','HEAD'],f.repo),f.second);assert.equal(fs.readFileSync(path.resolve(f.updater.appPath,'../../TechPractice.exe'),'utf8'),'old');
 await f.updater.install();assert.equal(f.backups(),2);assert.equal(f.installed().parentPid,process.pid);
 f.updater.commit=f.second;f.updater.state.status='idle';assert.equal((await f.updater.check()).status,'current');
});
test('dirty tracked and untracked files block updates without losing source',async()=>{for(const filename of ['content.txt','personal.txt']){const f=await fixture();await f.updater.check();write(path.join(f.repo,filename),'personal work');await f.updater.start();await f.updater.task;assert.equal(f.updater.snapshot().status,'error');assert.match(f.updater.snapshot().message,/未提交/);assert.equal(fs.readFileSync(path.join(f.repo,filename),'utf8'),'personal work');assert.equal(await f.g(['rev-parse','HEAD'],f.repo),f.first);}});
test('feature branches and divergent history are never overwritten',async()=>{for(const kind of ['branch','diverged']){const f=await fixture();await f.updater.check();if(kind==='branch')await f.g(['checkout','-b','feature'],f.repo);else{await f.g(['config','user.name','Test'],f.repo);await f.g(['config','user.email','test@example.invalid'],f.repo);write(path.join(f.repo,'local.txt'),'local commit');await f.g(['add','.'],f.repo);await f.g(['commit','-m','local'],f.repo);}const original=await f.g(['rev-parse','HEAD'],f.repo);await f.updater.start();await f.updater.task;assert.equal(f.updater.snapshot().status,'error');assert.equal(await f.g(['rev-parse','HEAD'],f.repo),original);}});
test('network failure has retry state; fallback mirror can still detect update',async()=>{const f=await fixture();const good=f.updater.run;f.updater.run=async(file,args,options)=>{if(args[0]==='ls-remote')throw Error('offline');return good(file,args,options)};assert.equal((await f.updater.check()).status,'error');f.updater.run=good;f.updater.remotes=['https://127.0.0.1:1/unreachable.git',f.remote];assert.equal((await f.updater.check()).status,'available');});
test('guards prevent updating or restarting with unsaved work; build failure preserves old runnable files',async()=>{const f=await fixture();await f.updater.check();f.updater.guard=()=>{throw Error('unsaved')};await assert.rejects(()=>f.updater.start(),/unsaved/);f.updater.guard=()=>{};f.updater.build=async()=>{throw Error('build fixture')};await f.updater.start();await f.updater.task;assert.equal(f.updater.snapshot().status,'error');assert.match(f.updater.snapshot().message,/build fixture/);assert.equal(fs.readFileSync(path.resolve(f.updater.appPath,'../../TechPractice.exe'),'utf8'),'old');await assert.rejects(()=>f.updater.install(),/尚未/);});
test('install plan rejects paths outside runtime sibling directory and incomplete bundles',async()=>{const f=await fixture();await f.updater.check();await f.updater.start();await f.updater.task;assert.equal(f.updater.state.status,'ready');assert.throws(()=>validateInstallPlan({...f.updater.plan,backup:path.join(f.root,'outside')}),/目录/);assert.throws(()=>validateInstallPlan({...f.updater.plan,stage:f.root}),/目录/);fs.unlinkSync(path.join(f.updater.plan.stage,'TechPractice.exe'));assert.throws(()=>validateInstallPlan(f.updater.plan),/不完整/);});
test('repository association rejects unrelated folders and test mode never contacts remote',async()=>{const f=await fixture();await assert.rejects(()=>f.updater.associate(f.root),/选择知习/);assert.equal((await f.updater.associate(f.repo)).repo,f.repo);f.updater.network=false;f.updater.run=async(file,args,o)=>{assert.notEqual(args[0],'ls-remote');return runCommand(file,args,o)};f.updater.state.status='idle';assert.equal((await f.updater.check()).status,'idle');});
test('production subprocess path runs actual npm ci and build scripts in isolated fixture',async()=>{
 const f=await fixture(),pkg={name:'update-fixture',version:'1.0.0',scripts:{'prepare:assets':'node -e "process.exit(0)"',package:'node package.cjs'}};
 write(path.join(f.seed,'tech-practice/package.json'),JSON.stringify(pkg));write(path.join(f.seed,'tech-practice/package-lock.json'),JSON.stringify({name:pkg.name,version:pkg.version,lockfileVersion:3,packages:{'':{name:pkg.name,version:pkg.version}}}));
 write(path.join(f.seed,'tech-practice/package.cjs'),`const fs=require('fs'),p=require('path'),cp=require('child_process');const s=process.env.TECH_PRACTICE_PACKAGE_DIR;fs.mkdirSync(p.join(s,'resources/app'),{recursive:true});fs.writeFileSync(p.join(s,'TechPractice.exe'),'fixture');fs.writeFileSync(p.join(s,'resources/app/package.json'),'{}');const commit=cp.execFileSync(${JSON.stringify(git)},['rev-parse','HEAD'],{encoding:'utf8'}).trim();fs.writeFileSync(p.join(s,'resources/app/build-info.json'),JSON.stringify({commit}));`);
 await f.g(['add','.']);await f.g(['commit','-m','build scripts']);await f.g(['push','origin','master:main']);f.updater.build=null;await f.updater.check();await f.updater.start();await f.updater.task;assert.equal(f.updater.state.status,'ready',f.updater.state.message);
});
test('Windows helper swaps isolated runtime, starts new EXE and rolls back failed launch', {skip:process.platform!=='win32'},async()=>{
 const root=fs.mkdtempSync(path.join(base,'installer-')),compiler=path.join(process.env.WINDIR,'Microsoft.NET/Framework64/v4.0.30319/csc.exe');
 for(const fail of [false,true]){
  const folder=path.join(root,String(fail));fs.mkdirSync(folder);const target=path.join(folder,'runtime'),stage=path.join(folder,'.wisdom-update-1234'),backup=path.join(folder,'.wisdom-backup-1234'),marker=path.join(folder,'marker.txt');
  for(const [dir,label] of [[target,'old'],[stage,'new']]){write(path.join(dir,'resources/app/package.json'),'{}');if(fail&&label==='new')write(path.join(dir,'TechPractice.exe'),'not executable');else{const source=path.join(folder,label+'.cs');write(source,`using System;using System.IO;class Program{static void Main(){File.WriteAllText(Environment.GetEnvironmentVariable("TP_UPDATE_MARKER"),"${label}");}}`);await runCommand(compiler,['/nologo','/target:winexe','/out:'+path.join(dir,'TechPractice.exe'),source],{cwd:root});}}
  const plan=path.join(folder,'plan.json');write(plan,JSON.stringify({target,stage,backup,parentPid:2147483647}));await runCommand('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.resolve('desktop/install-update.ps1'),'-PlanFile',plan],{cwd:root,env:{TP_UPDATE_MARKER:marker},timeout:20000});
  for(let i=0;i<50&&!fs.existsSync(marker);i++)await new Promise(r=>setTimeout(r,100));assert.equal(fs.readFileSync(marker,'utf8'),fail?'old':'new');assert.equal(JSON.parse(fs.readFileSync(plan+'.result.json','utf8').replace(/^\uFEFF/,'')).status,fail?'error':'installed');assert.equal(fs.existsSync(backup),!fail);
 }
});
test('local edits made during a build prevent installing the mixed source bundle',async()=>{const f=await fixture();const original=f.updater.build;f.updater.build=async args=>{await original(args);write(path.join(f.repo,'content.txt'),'editing during build')};await f.updater.check();await f.updater.start();await f.updater.task;assert.equal(f.updater.state.status,'error');assert.match(f.updater.state.message,/构建期间发现/);assert.equal(fs.readFileSync(path.resolve(f.updater.appPath,'../../TechPractice.exe'),'utf8'),'old');});
