import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { _electron as electron } from 'playwright';
const root=path.resolve('.'),out=path.join(root,'test-results/startup');fs.mkdirSync(out,{recursive:true});
const data=fs.mkdtempSync(path.join(out,'data-'));
const executable=process.env.TECH_PACKAGED_EXE||path.join(root,'node_modules/electron/dist/electron.exe');
async function launch(dataDir){const env={...process.env,TECH_PRACTICE_TEST:'1',TECH_PRACTICE_DATA_DIR:dataDir};delete env.ELECTRON_RUN_AS_NODE;return electron.launch({executablePath:executable,args:[...(process.env.TECH_PACKAGED_EXE?[]:[root]),'--user-data-dir='+path.join(dataDir,'chromium')],env,timeout:30000});}
async function mainWindow(app){for(let n=0;n<600;n++){const page=app.windows().find(p=>p.url().endsWith('/dist/index.html'));if(page&&!app.windows().some(p=>p.url().endsWith('/startup/index.html')))return page;await new Promise(r=>setTimeout(r,50));}throw Error('Main handoff timed out');}
const checks=[],allErrors=[];let previousQuote;
for(let run=0;run<2;run++){
 const app=await launch(data);
 try{
  const splash=await app.firstWindow();splash.on('pageerror',e=>allErrors.push(e.message));
  await splash.waitForFunction(()=>!!window.startup);
  const state=await splash.evaluate(()=>window.startup.snapshot());
  assert.ok(state.quote);assert.ok(state.progress>=0&&state.progress<=100);
  if(run===0){
   await splash.waitForFunction(()=>Number(getComputedStyle(document.getElementById('quote')).opacity)>.99);
   // Capture the real startup window; no injected percentage or fake quote.
   const png=await app.evaluate(async({BrowserWindow})=>{const s=BrowserWindow.getAllWindows().find(w=>w.getTitle()==='知习 · 正在开启');if(!s)return null;await s.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true});await new Promise(r=>setTimeout(r,120));if(s.isDestroyed())return null;return(await s.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG().toString('base64')});
   if(png)fs.writeFileSync(path.join(out,'启动过场.png'),Buffer.from(png,'base64'));
  }
  const page=await mainWindow(app);await page.getByRole('heading',{name:'今天，学会一点新东西。'}).waitFor();
  const events=await app.evaluate(()=>globalThis.__startupEvents);
  const actual=events.filter(x=>!x.leaving).map(x=>x.progress);
  assert.deepEqual(actual,[6,12,35,46,62,70,78,86,94,100]);
  assert.ok(events.every((x,i)=>!i||x.progress>=events[i-1].progress));assert.equal(events.at(-1).progress,100);
  if(previousQuote)assert.notEqual(previousQuote,state.quote);previousQuote=state.quote;
  checks.push(run===0?'Real startup milestones, quote and main-window handoff':'Persisted next-launch quote changes without losing data');
  if(run===1&&process.env.TECH_PACKAGED_EXE){
   // Observe the second-instance behavior without bringing test windows forward.
   await app.evaluate(({BrowserWindow})=>{globalThis.__activationCount=0;const w=BrowserWindow.getAllWindows()[0];w.show=()=>{globalThis.__activationCount++};w.focus=()=>{};});
   const env={...process.env,TECH_PRACTICE_TEST:'1',TECH_PRACTICE_DATA_DIR:data};delete env.ELECTRON_RUN_AS_NODE;
   const child=spawnSync(path.resolve('../知习.exe'),['--user-data-dir='+path.join(data,'chromium')],{env,windowsHide:true,timeout:10000,encoding:'utf8'});assert.equal(child.status,0,child.stderr);
   for(let i=0;i<100;i++){if(await app.evaluate(()=>globalThis.__activationCount))break;await new Promise(r=>setTimeout(r,50));}
   assert.ok(await app.evaluate(()=>globalThis.__activationCount)>0);assert.equal(app.windows().length,1);
   checks.push('Native EXE launcher activates the existing app instead of opening another workspace');
  }
 }finally{await app.close();}
}
const broken=fs.mkdtempSync(path.join(out,'broken-'));fs.mkdirSync(path.join(broken,'state'));fs.writeFileSync(path.join(broken,'state','learning.sqlite'),'invalid sqlite fixture');
const bad=await launch(broken);
try{
 const splash=await bad.firstWindow();await splash.locator('#error-panel').waitFor({state:'visible',timeout:15000});
 const s=await splash.evaluate(()=>window.startup.snapshot());assert.ok(s.error);assert.ok(s.progress<100);
 assert.equal(bad.windows().filter(w=>w.url().endsWith('/dist/index.html')).length,0);
 await splash.getByRole('button',{name:'重新启动',exact:true}).waitFor();
 assert.equal(await splash.locator('#progress').getAttribute('max'),'100');
 checks.push('Broken database keeps progress below 100 and exposes retry/exit instead of hanging');
}finally{await bad.close();}
assert.deepEqual(allErrors,[]);
fs.writeFileSync(path.join(out,process.env.TECH_PACKAGED_EXE?'packaged-report.json':'report.json'),JSON.stringify({checks,rendererErrors:allErrors,passed:checks.length,dataDirectory:data},null,2));
console.log(JSON.stringify({passed:checks.length,checks,rendererErrors:allErrors},null,2));
