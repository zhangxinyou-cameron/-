import {ensure} from '../util.mjs';
export const manifest={id:'updates',name:'软件更新',version:'1.0.0',apiVersion:1,description:'在左下角检测 Git 仓库提交，一键同步、构建并重启更新。',defaultEnabled:true};
export function activate({updater}){return {handlers:{status:()=>updater?.snapshot()||{status:'unconfigured',message:'更新服务未初始化'},check:()=>{ensure(updater,'更新服务未初始化');return updater.check()},start:()=>{ensure(updater,'更新服务未初始化');return updater.start()},install:()=>{ensure(updater,'更新服务未初始化');return updater.install()}},dispose(){}};}
