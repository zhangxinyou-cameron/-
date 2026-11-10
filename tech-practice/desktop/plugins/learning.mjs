import {ensure,canonical,hash} from '../util.mjs';
const idPattern=/^[a-z][a-z0-9_-]{0,95}$/;
const validId=x=>typeof x==='string'&&idPattern.test(x);
const version=s=>typeof s==='string'&&/^\d+\.\d+\.\d+$/.test(s);
const compare=(a,b)=>{const x=a.split('.').map(Number),y=b.split('.').map(Number);for(let i=0;i<3;i++)if(x[i]!==y[i])return x[i]-y[i];return 0;};
export const manifest={id:'learning',name:'学习中心',version:'1.0.0',apiVersion:1,description:'阅读、写作、笔记与章节练习，串起输入到输出。',defaultEnabled:true};
export function activate({store,validator}){
 const get=(key,fallback=null)=>{const r=store.one('SELECT value FROM meta WHERE key=?',[key]);return r?JSON.parse(r.value):fallback;};
 const put=(key,value)=>store.db.run('INSERT OR REPLACE INTO meta VALUES(?,?)',[key,JSON.stringify(value)]);
 const packKey=id=>'plugin:learning:pack:'+id;
 const stateKey=(id,chapter)=>'plugin:learning:chapter:'+id+':'+chapter;
 const pack=id=>{ensure(validId(id),'无效课程 ID');const p=get(packKey(id));ensure(p,'课程不存在');return p;};
 const state=(id,c)=>get(stateKey(id,c),{note_md:'',content_md:null,read_version:null});
 function validate(p){
  ensure(p&&typeof p==='object'&&!Array.isArray(p),'课程必须是 JSON 对象');
  ensure(Object.keys(p).every(k=>['schema_version','id','title','version','description','chapters','qbank'].includes(k)),'课程含未知字段');
  ensure(p.schema_version==='1.0'&&validId(p.id)&&version(p.version),'课程协议、ID 或版本无效');
  ensure(typeof p.title==='string'&&p.title.trim()&&p.title.length<=200,'课程名称不能为空或过长');
  ensure(p.description===undefined||typeof p.description==='string','description 必须为文本');
  ensure(Array.isArray(p.chapters)&&p.chapters.length>0&&p.chapters.length<=200,'课程需要 1～200 个章节');
  ensure(Buffer.byteLength(JSON.stringify(p))<=8*1024*1024,'课程超过 8 MiB');
  let checked=null;if(p.qbank){checked=validator.validate(p.qbank);ensure(checked.valid,'附带题库校验失败：'+JSON.stringify(checked.errors).slice(0,1000));}
  const ids=new Set();let refs=0;
  for(const c of p.chapters){
   ensure(c&&typeof c==='object'&&Object.keys(c).every(k=>['id','title','knowledge_points','content_md','question_refs'].includes(k)),'章节含未知字段');
   ensure(validId(c.id)&&!ids.has(c.id),'章节 ID 无效或重复');ids.add(c.id);
   ensure(typeof c.title==='string'&&c.title.trim()&&c.title.length<=200,'章节标题无效');
   ensure(typeof c.content_md==='string'&&c.content_md.trim()&&c.content_md.length<=500000,'章节正文无效或过长');
   ensure(Array.isArray(c.knowledge_points)&&c.knowledge_points.length>0&&c.knowledge_points.every(x=>typeof x==='string'&&x.trim()&&x.length<=200),'每章需要知识点');
   ensure(Array.isArray(c.question_refs)&&c.question_refs.length>0,'每章至少关联一道测试题');
   const unique=new Set();for(const r of c.question_refs){
    ensure(r&&Object.keys(r).every(k=>['bank_id','question_id'].includes(k))&&validId(r.bank_id)&&validId(r.question_id),'题目引用无效');
    const key=r.bank_id+'/'+r.question_id;ensure(!unique.has(key),'章节含重复题目引用');unique.add(key);refs++;
    const inEmbedded=checked?.bank.bank_id===r.bank_id&&checked.bank.questions.some(q=>q.id===r.question_id);
    ensure(inEmbedded||store.one('SELECT key FROM questions WHERE bank_id=? AND id=? AND current=1',[r.bank_id,r.question_id]),'找不到关联题目：'+key);
   }
  }ensure(refs<=1000,'课程关联题目不能超过 1000 条');
  const old=get(packKey(p.id));if(old){const n=compare(p.version,old.version);ensure(n>=0,'不能导入较旧的课程版本');ensure(n!==0||canonical(old)===canonical(p),'同版本内容冲突，请递增课程 version');}
  return checked;
 }
 function detail(id){const p=pack(id);return {...p,chapters:p.chapters.map(c=>{const s=state(id,c.id);const questions=c.question_refs.map(r=>{const row=store.one('SELECT key,payload FROM questions WHERE bank_id=? AND id=? AND current=1',[r.bank_id,r.question_id]);if(!row)return {...r,missing:true,passed:false};const q=JSON.parse(row.payload);return {...r,key:row.key,title:q.title,passed:!!store.one("SELECT id FROM attempts WHERE qkey=? AND status='AC' AND assisted=0 LIMIT 1",[row.key])};});const read=s.read_version===p.version;return {...c,state:s,read,questions,completed:read&&questions.every(q=>q.passed)};})};}
 return {handlers:{
  list:()=>store.all("SELECT value FROM meta WHERE key LIKE 'plugin:learning:pack:%'").map(r=>{const p=JSON.parse(r.value),d=detail(p.id);return {id:p.id,title:p.title,description:p.description||'',version:p.version,chapters:d.chapters.length,completed:d.chapters.filter(c=>c.completed).length};}),
  detail:({id})=>detail(id),
  import:({pack:p})=>{const checked=validate(p);return store.transaction(()=>{if(checked)store.importBank(checked.bank);put(packKey(p.id),p);return {id:p.id,title:p.title,chapters:p.chapters.length};});},
  save:({id,chapterId,patch})=>{const p=pack(id);ensure(p.chapters.some(c=>c.id===chapterId),'章节不存在');ensure(patch&&Object.keys(patch).every(k=>['note_md','content_md','read'].includes(k)),'不支持的章节字段');for(const k of ['note_md','content_md'])if(Object.hasOwn(patch,k))ensure(typeof patch[k]==='string'&&patch[k].length<=500000,'文本无效或过长');if(Object.hasOwn(patch,'content_md'))ensure(patch.content_md.trim(),'章节正文不能为空');if(Object.hasOwn(patch,'read'))ensure(typeof patch.read==='boolean','已读状态必须为布尔值');return store.transaction(()=>{const s=state(id,chapterId);for(const k of ['note_md','content_md'])if(Object.hasOwn(patch,k))s[k]=patch[k];if(Object.hasOwn(patch,'content_md'))s.read_version=null;if(Object.hasOwn(patch,'read'))s.read_version=patch.read?p.version:null;put(stateKey(id,chapterId),s);return s;});},
  quiz:({id,chapterId})=>{const c=detail(id).chapters.find(c=>c.id===chapterId);ensure(c,'章节不存在');ensure(c.questions.every(q=>q.key),'关联题库缺失，请重新导入');return c.questions.map(q=>q.key);},
  startQuiz:({id,chapterId})=>{const p=detail(id),c=p.chapters.find(c=>c.id===chapterId);ensure(c,'章节不存在');ensure(c.questions.every(q=>q.key),'关联题库缺失，请重新导入');return store.transaction(()=>{const s=state(id,chapterId);s.read_version=p.version;put(stateKey(id,chapterId),s);return store.startSession(c.questions.map(q=>q.key),'sequence',0,{id:'learning',courseId:id,chapterId});});},
  export:({id})=>{const p=structuredClone(pack(id));let edited=false;for(const c of p.chapters){const s=state(id,c.id);if(s.content_md!==null){c.content_md=s.content_md;edited=true;}}if(edited){const key='plugin:learning:export:'+id,digest=hash(p),old=get(key);if(old?.digest===digest)p.version=old.version;else{const start=old&&compare(old.version,p.version)>0?old.version:p.version;const v=start.split('.').map(Number);v[2]++;p.version=v.join('.');store.transaction(()=>put(key,{digest,version:p.version}));}}return p;}
 },dispose(){}};
}
