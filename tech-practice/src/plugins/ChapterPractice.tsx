import React,{useEffect,useState} from 'react';
import {api} from '../api';
import {Button,useApp} from '../components';

export default function ChapterPractice({beforeLeave,disabled}:any){
 const {session,boot,navigate,notify}=useApp();
 const origin=session.pluginContext;
 const [course,setCourse]=useState<any>(null),[error,setError]=useState('');
 useEffect(()=>{let active=true;setCourse(null);setError('');api<any>('plugin',{id:'learning',action:'detail',payload:{id:origin.courseId}}).then(p=>{if(active)setCourse(p)}).catch(e=>{if(active)setError(e.message)});return()=>{active=false}},[session.id,boot]);
 const index=course?.chapters.findIndex((c:any)=>c.id===origin.chapterId)??-1;
 const chapter=index>=0?course.chapters[index]:null,next=chapter?course.chapters[index+1]:null;
 const go=async(chapterId?:string)=>{try{await beforeLeave();await navigate('plugin:learning',chapterId?{courseId:origin.courseId,chapterId}:{})}catch(e:any){notify(e.message,'error')}};
 return <section className="panel chapter-practice" aria-label="章节学习进度"><div><strong>{course?.title||'章节练习'}{chapter&&` · ${chapter.title}`}</strong><p role="status">{error||(!course?'正在更新章节进度…':!chapter?'原章节已变更，请返回学习中心。':chapter.completed?'本章学习已完成':`${chapter.read?'已读':'待读'} · ${chapter.questions.filter((q:any)=>q.passed).length}/${chapter.questions.length} 题独立通过` )}</p>{chapter&&!chapter.completed&&<small>关联题目全部独立通过后完成本章；辅助作答或答错仍需独立重练。</small>}</div><div className="button-row"><Button disabled={disabled} onClick={()=>go(chapter?.id)}>{chapter?'返回本章':'返回学习中心'}</Button>{next?<Button kind="primary" disabled={disabled} onClick={()=>go(next.id)}>下一章：{next.title}</Button>:chapter&&<Button kind="primary" disabled={disabled} onClick={()=>go()}>返回课程列表</Button>}</div></section>;
}
