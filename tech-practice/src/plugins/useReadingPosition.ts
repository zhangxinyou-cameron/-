import {useEffect,useLayoutEffect} from 'react';
import {api} from '../api';

export default function useReadingPosition(courseId:string|undefined,chapterId:string,scrollTop:number,onError:(message:string)=>void){
 useLayoutEffect(()=>{if(!courseId)return;document.querySelector('.main-scroll')?.scrollTo({top:scrollTop,behavior:'instant'})},[courseId,chapterId]);
 useEffect(()=>{
  if(!courseId)return;const el=document.querySelector('.main-scroll');if(!el)return;
  let top=el.scrollTop,timer:ReturnType<typeof setTimeout>|undefined,reported=false;
  const persist=()=>api('plugin',{id:'learning',action:'visit',payload:{id:courseId,chapterId,scrollTop:top}}).catch((e:any)=>{if(!reported){reported=true;onError('阅读位置未保存：'+e.message)}});
  const scrolled=()=>{top=el.scrollTop;clearTimeout(timer);timer=setTimeout(persist,250)};
  const flush=(e:any)=>e.detail.tasks.push(persist());
  const unload=()=>{clearTimeout(timer);persist()};
  persist();el.addEventListener('scroll',scrolled);window.addEventListener('beforeunload',unload);window.addEventListener('practice:flush',flush);
  return()=>{clearTimeout(timer);el.removeEventListener('scroll',scrolled);window.removeEventListener('beforeunload',unload);window.removeEventListener('practice:flush',flush);persist()};
 },[courseId,chapterId]);
}
