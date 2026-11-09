import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { X, Check, Circle, AlertCircle, Copy, Cpu, Braces, Code2, ChevronRight, LoaderCircle } from 'lucide-react';
import { api, typeNames } from './api';

export const AppContext = createContext<any>(null);
export const useApp = () => useContext(AppContext);
export function Icon({name, size=20}: {name?:string,size?:number}) { const C = name === 'digital_ic' ? Cpu : name === 'programming' ? Braces : Code2; return <C size={size}/>; }
export function Button({children,kind='',className='',...props}:any) {return <button className={`button ${kind} ${className}`} {...props}>{children}</button>}
export function Badge({children,tone=''}:any){return <span className={`badge ${tone}`}>{children}</span>}
export function Empty({icon: I=Circle,title,description,action}:any){return <div className="empty"><span className="empty-icon"><I size={28}/></span><h3>{title}</h3><p>{description}</p>{action}</div>}
export function Modal({title,children,onClose,wide=false,footer=null}:any){
  const ref = useRef<HTMLDivElement>(null);
  useEffect(()=>{const previous=document.activeElement as HTMLElement; ref.current?.focus(); const fn=(e:KeyboardEvent)=>{if(e.key==='Escape')onClose(); if(e.key==='Tab'){const items=ref.current?.querySelectorAll<HTMLElement>('button:not([disabled]),input,textarea,select,[tabindex="0"]');if(!items?.length)return;const a=items[0],b=items[items.length-1];if(e.shiftKey&&document.activeElement===a){e.preventDefault();b.focus()}else if(!e.shiftKey&&document.activeElement===b){e.preventDefault();a.focus()}}};document.addEventListener('keydown',fn);return()=>{document.removeEventListener('keydown',fn);previous?.focus()};},[]);
  return <div className="modal-shade" onMouseDown={e=>{if(e.target===e.currentTarget)onClose()}}><div ref={ref} tabIndex={-1} className={`modal ${wide?'wide':''}`} role="dialog" aria-modal="true" aria-label={title}><div className="modal-title"><h2>{title}</h2><button className="icon-button" aria-label="关闭对话框" onClick={onClose}><X size={20}/></button></div><div className="modal-body">{children}</div>{footer&&<div className="modal-footer">{footer}</div>}</div></div>
}
export function Markdown({text='',files={}}:any){
  const html = React.useMemo(()=>{
    const safe=DOMPurify.sanitize(marked.parse(text,{async:false}) as string,{ALLOWED_TAGS:['h1','h2','h3','h4','p','ul','ol','li','code','pre','blockquote','strong','em','a','hr','table','thead','tbody','tr','th','td','br','del','img'],ALLOWED_ATTR:['href','src','title','alt','colspan','rowspan']});
    const template=document.createElement('template');template.innerHTML=safe;
    template.content.querySelectorAll('img').forEach(image=>{const src=image.getAttribute('src')||'';const f=files[src];const ext=src.split('.').pop()?.toLowerCase();const mime=ext==='png'?'image/png':['jpg','jpeg'].includes(ext||'')?'image/jpeg':null;if(f?._base64&&mime){image.src=`data:${mime};base64,${f._base64}`}else image.remove()});
    template.content.querySelectorAll('a').forEach(a=>{if(!/^https?:\/\//i.test(a.getAttribute('href')||''))a.removeAttribute('href')});
    return template.innerHTML;
  },[text,files]);
  return <div className="markdown" onClick={e=>{const link=(e.target as HTMLElement).closest('a');if(link){e.preventDefault();const url=link.getAttribute('href');if(url)api('openExternal',{url}).catch(()=>{})}}} dangerouslySetInnerHTML={{__html:html}}/>
}
export function Difficulty({value}:any){return <span className={`difficulty d${value}`}>{['','入门','基础','进阶','困难','挑战'][value]||value}<i>{Array.from({length:5},(_,i)=><b key={i} className={i<value?'on':''}/>)}</i></span>}
export function BankCard({bank,onOpen,onEdit,onExport,onArchive}:any){
  const domain=bank.domains?.includes('digital_ic')?'digital_ic':'programming';
  return <article className="bank-card"><button className="bank-main" onClick={onOpen}><span className={`bank-icon ${domain}`}><Icon name={domain} size={25}/></span><span className="bank-heading"><h3>{bank.title}</h3><span className="muted">{bank.description}</span></span><ChevronRight size={17} className="muted"/></button><div className="bank-tags"><Badge>{bank.count} 道题</Badge>{bank.types?.includes('rtl')&&<Badge tone="teal">RTL 仿真</Badge>}{bank.types?.includes('code')&&<Badge tone="blue">代码练习</Badge>}<small>v{bank.version}</small></div><div className="progress-track"><span style={{width:`${bank.count?bank.solved/bank.count*100:0}%`}}/></div><div className="bank-bottom"><span>已通过 <strong>{bank.solved}</strong> / {bank.count}</span>{onEdit?<div className="mini-actions"><button onClick={onEdit}>编辑</button><button onClick={onExport}>导出</button><button onClick={onArchive}>{bank.archived?'恢复':'归档'}</button></div>:<span>{Math.round(bank.solved/Math.max(bank.count,1)*100)}%</span>}</div></article>
}
export function Busy({label='正在加载…'}:any){return <div className="loading"><LoaderCircle className="spin" size={22}/><span>{label}</span></div>}
export function ResultIcon({status}:any){return status==='AC'?<Check size={17}/>:['ENV_ERROR','JUDGE_ERROR','CANCELED'].includes(status)?<AlertCircle size={17}/>:<X size={17}/>}
export function QuestionType({type}:any){return <Badge tone={type==='rtl'?'teal':type==='code'?'blue':''}>{typeNames[type]||type}</Badge>}
