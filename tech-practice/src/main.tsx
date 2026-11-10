import React,{useCallback,useEffect,useRef,useState} from 'react';
import { createRoot } from 'react-dom/client';
import { BookOpen, CheckCircle2, ChevronRight, CircleHelp, Cpu, Database, FolderHeart, GraduationCap, LayoutDashboard, Layers3, Monitor, Moon, Plus, RotateCcw, Settings2, ShieldCheck, Sun, TrendingUp, X } from 'lucide-react';
import { api } from './api';
import { AppContext, Busy, Button } from './components';
import Home from './Home';
import Library,{ImportDialog} from './Library';
import Practice from './Practice';
import {Collections,Review,Statistics,Topics} from './Learning';
import {Environments,Settings} from './Settings';
import './styles.css';
import './learning.css';
import Plugins from './Plugins';
import UpdateNotice from './UpdateNotice';
import {pluginViews} from './plugins/index';

const pages=[['home','今日学习',LayoutDashboard],['library','我的题库',BookOpen],['topics','知识专题',Layers3],['review','错题与复习',RotateCcw],['collections','收藏与笔记',FolderHeart],['stats','学习统计',TrendingUp],['environments','运行环境',Monitor],['settings','偏好与数据',Settings2],['plugins','插件管理',Layers3]] as const;
function App(){
  const [boot,setBoot]=useState<any>(null),[questions,setQuestions]=useState<any[]>([]),[page,setPage]=useState('home'),[pageParams,setPageParams]=useState<any>({}),[session,setSession]=useState<any>(null),[importText,setImportText]=useState<string|null>(null),[notices,setNotices]=useState<any[]>([]),[fatal,setFatal]=useState('');
  const notify=useCallback((message:string,tone='success')=>{const id=Date.now()+Math.random();setNotices(old=>[...old,{id,message,tone}]);setTimeout(()=>setNotices(old=>old.filter(n=>n.id!==id)),5500)},[]);
  const refresh=useCallback(async()=>{const [data,list]=await Promise.all([api('bootstrap'),api('questions')]);setBoot(data);setQuestions(list);return data},[]);
  const readySent=useRef(false);
  useEffect(()=>{refresh().catch((e:any)=>{setFatal(e.message);window.practice.startupFailed(e.message)})},[]);
  useEffect(()=>{if(!boot||readySent.current)return;let first=0,second=0;first=requestAnimationFrame(()=>{second=requestAnimationFrame(()=>{readySent.current=true;window.practice.startupReady()})});return()=>{cancelAnimationFrame(first);cancelAnimationFrame(second)}},[boot]);
  useEffect(()=>{if(boot)document.documentElement.dataset.theme=boot.settings.theme},[boot?.settings.theme]);
  const navigate=async(target:string,params:any={})=>{if(!await api('confirmNavigation'))return;setPage(target);setPageParams(params);document.querySelector('.main-scroll')?.scrollTo({top:0})};
  const startPractice=async(keys:string[]|null,mode:string|null='sequence',existing:any=null)=>{try{const next=existing||await api('startSession',{keys,mode});setSession(next);navigate('practice')}catch(e:any){notify(e.message,'error')}};
  const toggleBookmark=async(q:any)=>{try{await api('annotate',{identity:q.bankId+'/'+q.id,patch:{bookmarked:!q.bookmarked}});await refresh();notify(q.bookmarked?'已取消收藏':'已加入收藏')}catch(e:any){notify(e.message,'error')}};
  useEffect(()=>{if(boot&&page.startsWith('plugin:')&&!boot.plugins?.some((p:any)=>p.id===page.slice(7)&&p.enabled))setPage('home')},[boot,page]);
  if(fatal)return <div className="startup-error"><h1>启动遇到问题</h1><p>{fatal}</p><Button onClick={()=>{setFatal('');refresh().catch((e:any)=>setFatal(e.message))}}>重新加载</Button></div>;
  if(!boot)return <div className="startup"><div className="brand-mark">知</div><h2>知习</h2><Busy label="正在打开你的技术练习室…"/></div>;

  const PluginView=page.startsWith('plugin:')?pluginViews[page.slice(7)]:null;
  const current=pages.find(p=>p[0]===page),title=current?.[1]||boot.plugins?.find((p:any)=>'plugin:'+p.id===page)?.name||'练习工作台';
  return <AppContext.Provider value={{boot,questions,refresh,notify,navigate,pageParams,session,setSession,startPractice,toggleBookmark,openImport:(text='')=>setImportText(typeof text==='string'?text:'')}}><div className="app-shell"><aside className="sidebar"><button className="brand" onClick={()=>navigate('home')}><span className="brand-mark"><Cpu size={25}/></span><span><strong>知习</strong><small>技术练习室</small></span></button><div className="sidebar-caption">学习空间</div><nav>{pages.slice(0,6).map(([id,label,I])=><button key={id} className={page===id?'active':''} onClick={()=>navigate(id)}><I size={19}/><span>{label}</span>{id==='review'&&boot.overview.due>0&&<b>{boot.overview.due}</b>}</button>)}</nav><nav>{(boot.plugins||[]).filter((p:any)=>p.enabled&&pluginViews[p.id]).map((p:any)=><button key={p.id} className={page==='plugin:'+p.id?'active':''} onClick={()=>navigate('plugin:'+p.id)}><BookOpen size={19}/><span>{p.name}</span></button>)}</nav><div className="sidebar-caption tools-caption">工具与设置</div><nav>{pages.slice(6).map(([id,label,I])=><button key={id} className={page===id?'active':''} onClick={()=>navigate(id)}><I size={19}/><span>{label}</span></button>)}</nav><div className="sidebar-bottom">{boot.plugins?.some((p:any)=>p.id==='updates'&&p.enabled)&&<UpdateNotice/>}<div className="local-label"><ShieldCheck size={17}/><span>数据留在本地</span><span className="live-dot"/></div><p>按自己的节奏，持续进步。</p><div><span>v{boot.version}</span><button aria-label="切换主题" className="icon-button" onClick={async()=>{try{await api('settings',{patch:{theme:boot.settings.theme==='light'?'dark':'light'}});await refresh()}catch(e:any){notify(e.message,'error')}}}>{boot.settings.theme==='light'?<Moon size={15}/>:<Sun size={15}/>}</button></div></div></aside>
  <div className="main-region"><header className="topbar"><div><span>我的学习空间</span><ChevronRight size={14}/><strong>{title}</strong></div><div className="topbar-right"><span className="offline-label"><span className="live-dot"/>离线可学</span><span className="topbar-divider"/><button className="profile" onClick={()=>navigate('settings')} aria-label="打开个人偏好"><GraduationCap size={18}/></button></div></header><main className={`main-scroll ${page==='practice'?'practice-scroll':''}`}><div className={`page-content ${page==='practice'?'practice-content':''}`} key={page+(page==='library'?JSON.stringify(pageParams):'')}>
  {page==='home'?<Home/>:page==='library'?<Library/>:page==='topics'?<Topics/>:page==='review'?<Review/>:page==='collections'?<Collections/>:page==='stats'?<Statistics/>:page==='environments'?<Environments/>:page==='settings'?<Settings/>:page==='plugins'?<Plugins/>:PluginView?<PluginView/>:<Practice/>}
  </div></main></div></div><div className="toast-stack" role="status">{notices.map(n=><div className={`toast ${n.tone}`} key={n.id}>{n.tone==='error'?<CircleHelp size={18}/>:<CheckCircle2 size={18}/>}<span>{n.message}</span><button onClick={()=>setNotices(old=>old.filter(x=>x.id!==n.id))} aria-label="关闭通知"><X size={14}/></button></div>)}</div>{importText!==null&&<ImportDialog initialText={importText} onClose={()=>setImportText(null)}/>}</AppContext.Provider>
}
createRoot(document.getElementById('root')!).render(<App/>);
