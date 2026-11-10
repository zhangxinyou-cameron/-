import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {ensure,atomicWrite} from './util.mjs';

export const updateRemotes=['https://gitee.com/zhang-xinyou/wisdom-cultivator.git','https://github.com/zhangxinyou-cameron/-.git'];
export function runCommand(file,args,{cwd,env={},timeout=30000}={}){
 return new Promise((resolve,reject)=>{
  const child=spawn(file,args,{cwd,env:{...process.env,...env,GIT_TERMINAL_PROMPT:'0',GCM_INTERACTIVE:'Never'},windowsHide:true,stdio:['ignore','pipe','pipe'],shell:false});
  let output='',ended=false;
  const timer=setTimeout(()=>{if(process.platform==='win32')spawn('taskkill.exe',['/pid',String(child.pid),'/t','/f'],{windowsHide:true,stdio:'ignore'});else child.kill('SIGKILL');finish(Error('操作超时，请检查网络或构建环境'));},timeout);
  function finish(error){if(ended)return;ended=true;clearTimeout(timer);error?reject(error):resolve(output.trim());}
  child.stdout.on('data',v=>{output=(output+v).slice(-16000)});child.stderr.on('data',()=>{});
  child.on('error',()=>finish(Error('无法启动 '+path.basename(file)+'，请检查 Git / Node.js 安装')));
  child.on('close',code=>finish(code===0?null:Error(path.basename(file)+' 执行失败（退出码 '+code+'），请检查网络、仓库状态或构建环境')));
 });
}
const gitPath=()=>process.platform==='win32'&&fs.existsSync('C:/Program Files/Git/cmd/git.exe')?'C:/Program Files/Git/cmd/git.exe':'git';
export function validateInstallPlan(plan){
 const target=path.resolve(plan.target),stage=path.resolve(plan.stage),backup=path.resolve(plan.backup);
 ensure(target!==path.parse(target).root&&path.dirname(target)===path.dirname(stage)&&path.dirname(target)===path.dirname(backup),'更新目录无效');
 ensure(path.basename(stage).startsWith('.wisdom-update-')&&path.basename(backup).startsWith('.wisdom-backup-'),'更新目录名称无效');
 ensure(fs.existsSync(path.join(target,'TechPractice.exe'))&&fs.existsSync(path.join(target,'resources/app/package.json')),'仅支持更新打包后的知习程序');
 ensure(fs.existsSync(path.join(stage,'TechPractice.exe'))&&fs.existsSync(path.join(stage,'resources/app/package.json')),'新版程序不完整');
 for(const p of [target,stage])ensure(!fs.lstatSync(p).isSymbolicLink(),'更新目录不能为链接');
 ensure(!fs.existsSync(backup),'备份目录已存在');
 return {...plan,target,stage,backup};
}
export class Updater{
 constructor({appPath,dataDir,remotes=updateRemotes,run=runCommand,git=gitPath(),build,guard=()=>{},backup=()=>{},restart=()=>{},network=true,buildCommit=null}){
  Object.assign(this,{appPath,dataDir,remotes,run,git,build,guard,backup,restart,network});
  this.config=path.join(dataDir,'updates','repository.json');
  this.commit=buildCommit;try{this.commit??=JSON.parse(fs.readFileSync(path.join(appPath,'build-info.json'),'utf8')).commit}catch{}
  this.state={status:'idle',message:'尚未检查更新',progress:0,currentCommit:this.commit,remoteCommit:null,repo:null};
  try{const last=JSON.parse(fs.readFileSync(path.join(dataDir,'updates/install-plan.json.result.json'),'utf8').replace(/^\uFEFF/,''));if(last.status==='error')this.set({status:'error',message:'上次更新切换失败，原程序已保留：'+last.message});}catch{}
 }
 snapshot(){return structuredClone(this.state)}
 set(patch){Object.assign(this.state,patch);return this.snapshot()}
 async gitRun(args,repo,timeout=30000){return this.run(this.git,args,{cwd:repo,timeout})}
 async repository(){
  let saved;try{saved=JSON.parse(fs.readFileSync(this.config,'utf8')).repo}catch{}
  const candidates=[];if(saved)candidates.push(saved);let p=this.appPath;
  for(let i=0;i<9;i++){candidates.push(p);const next=path.dirname(p);if(next===p)break;p=next;}
  for(const candidate of candidates){if(!fs.existsSync(path.join(candidate,'.git'))||!fs.existsSync(path.join(candidate,'tech-practice/package.json')))continue;
   const root=await this.gitRun(['rev-parse','--show-toplevel'],candidate);
   if(path.resolve(root)!==path.resolve(candidate))continue;
   const urls=await this.gitRun(['config','--get-regexp','remote\..*\.url'],candidate);
   if(this.remotes.some(url=>urls.split(/\r?\n/).some(line=>line.split(/\s+/).at(-1)?.replace(/\.git$/,'').replace(/\/$/,'')===url.replace(/\.git$/,'').replace(/\/$/,''))))return path.resolve(candidate);
  }return null;
 }
 async associate(repo){ensure(!['updating','ready'].includes(this.state.status),'更新期间不能切换仓库');const old=fs.existsSync(this.config)?fs.readFileSync(this.config):null;atomicWrite(this.config,JSON.stringify({repo:path.resolve(repo)}));try{ensure(await this.repository()===path.resolve(repo),'请选择知习的 Gitee/GitHub 本地源码仓库');}catch(e){if(old)atomicWrite(this.config,old);else fs.unlinkSync(this.config);throw e;}return this.check();}
 async check(){
  if(['checking','updating','ready','installing'].includes(this.state.status))return this.snapshot();
  this.set({status:'checking',message:'正在检查仓库更新',progress:0});
  try{
   const repo=await this.repository();if(!repo)return this.set({status:'unconfigured',message:'请先关联知习本地源码仓库',repo:null});
   this.set({repo});
   if(!this.network)return this.set({status:'idle',message:'测试模式：自动联网检查已关闭'});
   let remote=null;
   for(const url of this.remotes){try{const out=await this.gitRun(['ls-remote','--heads',url,'main','master'],repo,12000);const refs=out.split(/\r?\n/).map(x=>x.split(/\s+/));const preferred=refs.find(x=>x[1]==='refs/heads/main')||refs.find(x=>x[1]==='refs/heads/master');if(preferred&&/^[0-9a-f]{40,64}$/.test(preferred[0])){remote={url,commit:preferred[0],branch:preferred[1].slice(11)};break;}}catch{}}
   ensure(remote,'无法连接更新仓库，请检查网络后重试');this.remote=remote;
   this.commit??=await this.gitRun(['rev-parse','HEAD'],repo);
   return this.set({status:remote.commit===this.commit?'current':'available',message:remote.commit===this.commit?'当前已是最新版本':'发现仓库新提交，可更新',currentCommit:this.commit,remoteCommit:remote.commit});
  }catch(e){return this.set({status:'error',message:e.message})}
 }
 async start(){
  ensure(this.state.status==='available'||this.state.status==='error','请先检查可用更新');
  this.guard();ensure(this.remote&&this.state.repo,'请先重新检查更新');
  this.set({status:'updating',progress:5,message:'检查本地修改和运行环境'});
  this.task=this.prepare().catch(e=>this.set({status:'error',message:this.state.message+'失败：'+e.message,progress:0}));
  return this.snapshot();
 }
 async prepare(){
  const repo=this.state.repo,target=path.resolve(this.appPath,'../..');
  ensure(path.basename(this.appPath)==='app'&&path.basename(path.dirname(this.appPath))==='resources'&&fs.existsSync(path.join(target,'TechPractice.exe')),'请用打包后的知习程序执行更新');
  const branch=await this.gitRun(['symbolic-ref','--short','HEAD'],repo);ensure(['main','master'].includes(branch),'当前不在 main/master 分支，更新已停止');
  ensure(!(await this.gitRun(['status','--porcelain','--untracked-files=normal'],repo)),'本地有未提交修改，请先提交或自行处理后再更新');
  const info=await this.tools(repo); // Resolve tools before changing source.
  this.backup();
  this.set({progress:15,message:'获取仓库最新提交'});
  const ref='refs/tech-practice/update';
  await this.gitRun(['fetch','--no-tags',this.remote.url,`+refs/heads/${this.remote.branch}:${ref}`],repo,120000);
  const commit=await this.gitRun(['rev-parse',ref],repo);
  await this.gitRun(['merge-base','--is-ancestor','HEAD',commit],repo).catch(()=>{throw Error('本地与远程已分叉或本地领先，已停止；请先整合代码')});
  // Recheck immediately before fast-forward; never stash, reset or force the worktree.
  ensure(!(await this.gitRun(['status','--porcelain','--untracked-files=normal'],repo)),'更新期间发现本地修改，已停止');
  await this.gitRun(['merge','--ff-only',commit],repo);
  const stage=path.join(path.dirname(target),'.wisdom-update-'+randomUUID());
  this.set({progress:35,message:'源码已同步，安装构建依赖'});
  if(this.build)await this.build({repo,stage,commit});
  else{
   const cwd=path.join(repo,'tech-practice'),env={TECH_PRACTICE_PACKAGE_DIR:stage};
   await this.run(info.node,[info.npm,'ci','--no-audit','--no-fund'],{cwd,env,timeout:900000});
   this.set({progress:60,message:'正在构建新版程序'});
   await this.run(info.node,[info.npm,'run','prepare:assets'],{cwd,env,timeout:120000});
   await this.run(info.node,[info.npm,'run','package'],{cwd,env,timeout:900000});
  }
  ensure(await this.gitRun(['rev-parse','HEAD'],repo)===commit,'构建期间仓库提交发生变化，已停止安装');
  ensure(!(await this.gitRun(['status','--porcelain','--untracked-files=normal'],repo)),'构建期间发现本地修改，已停止安装');
  const built=JSON.parse(fs.readFileSync(path.join(stage,'resources/app/build-info.json'),'utf8'));
  ensure(built.commit===commit,'新版构建提交与同步提交不一致');
  const plan=validateInstallPlan({target,stage,backup:path.join(path.dirname(target),'.wisdom-backup-'+randomUUID()),parentPid:process.pid});
  this.plan=plan;return this.set({status:'ready',progress:100,message:'新版已构建，重启完成更新',remoteCommit:commit});
 }
 async tools(repo){
  if(this.build)return {};
  const nodes=await this.run('where.exe',['node.exe'],{cwd:repo});
  for(const node of nodes.split(/\r?\n/)){
   if(!fs.existsSync(node))continue;
   const npm=path.join(path.dirname(node),'node_modules/npm/bin/npm-cli.js');
   if(!fs.existsSync(npm))continue;
   const v=await this.run(node,['--version'],{cwd:repo});
   if(Number(v.replace(/^v/,'').split('.')[0])>=24)return {node,npm};
  }throw Error('更新构建需要已安装 Node.js 24+ 与 npm');
 }
 async install(){ensure(this.state.status==='ready'&&this.plan,'新版尚未准备完成');this.guard();const plan=validateInstallPlan(this.plan);this.backup();this.set({status:'installing',message:'正在重启完成更新'});try{await this.restart(plan)}catch(e){this.set({status:'ready',message:'重启失败：'+e.message});throw e}return true;}
}
