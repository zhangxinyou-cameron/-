import React,{useEffect,useRef,useState} from 'react';
import * as monaco from 'monaco-editor/editor/editor.api';
import 'monaco-editor/languages/definitions/python/register';
import 'monaco-editor/languages/definitions/cpp/register';
import EditorWorker from 'monaco-editor/editor/editor.worker?worker';

window.MonacoEnvironment={getWorker:()=>new EditorWorker()};
monaco.languages.register({id:'verilog'});
monaco.languages.setMonarchTokensProvider('verilog',{tokenizer:{root:[[/\b(module|endmodule|input|output|wire|reg|logic|always|always_ff|always_comb|begin|end|if|else|posedge|negedge|assign|case|endcase|default|parameter|localparam|initial|for|integer|task|endtask)\b/,'keyword'],[/\/\/.*$/,'comment'],[/\/\*/,'comment','@comment'],[/\d+'[bhd][0-9a-f_xz]+/i,'number'],[/\b\d+\b/,'number'],[/".*?"/,'string'],[/\$[a-zA-Z_]+/,'type']],comment:[[/\*\//,'comment','@pop'],[/./,'comment']]}});
monaco.languages.register({id:'json'});
monaco.languages.setMonarchTokensProvider('json',{tokenizer:{root:[[ /"([^"\\]|\\.)*"(?=\s*:)/,'key'],[/"([^"\\]|\\.)*"/,'string'],[/\b(true|false|null)\b/,'keyword'],[/-?\d+(\.\d+)?/,'number']]}});
monaco.editor.defineTheme('practice-light',{base:'vs',inherit:true,rules:[{token:'comment',foreground:'8292A0'},{token:'keyword',foreground:'8B4FC7'},{token:'number',foreground:'B56A25'},{token:'key',foreground:'35628C'}],colors:{'editor.background':'#FCFDFE','editorLineNumber.foreground':'#A4ADB9','editor.lineHighlightBackground':'#F1F5F8','editor.selectionBackground':'#D6EAE8','editorGutter.background':'#FCFDFE'}});
export default function Editor({value,onChange,language='python',readOnly=false,fontSize=14,theme='light',label='代码编辑器'}:any){
  const host=useRef<HTMLDivElement>(null), view=useRef<monaco.editor.IStandaloneCodeEditor>(null), callback=useRef(onChange),[failed,setFailed]=useState(false);
  callback.current=onChange;
  useEffect(()=>{try{view.current=monaco.editor.create(host.current!,{value,language,readOnly,theme:theme==='dark'?'vs-dark':'practice-light',automaticLayout:true,fontSize,fontFamily:'Consolas, "Microsoft YaHei", monospace',lineHeight:24,tabSize:4,minimap:{enabled:false},scrollBeyondLastLine:false,padding:{top:16,bottom:16},wordWrap:'on',renderLineHighlight:'line',overviewRulerLanes:0,ariaLabel:label,quickSuggestions:true});const change=view.current.onDidChangeModelContent(()=>callback.current?.(view.current!.getValue()));return()=>{change.dispose();const model=view.current?.getModel();view.current?.dispose();model?.dispose()}}catch{setFailed(true)}},[]);
  useEffect(()=>{if(view.current&&view.current.getValue()!==value)view.current.setValue(value||'')},[value]);
  useEffect(()=>{if(view.current){monaco.editor.setModelLanguage(view.current.getModel()!,language);view.current.updateOptions({readOnly,fontSize});monaco.editor.setTheme(theme==='dark'?'vs-dark':'practice-light')}},[language,readOnly,fontSize,theme]);
  return failed?<textarea aria-label={label} className="editor-fallback" value={value} readOnly={readOnly} onChange={e=>onChange?.(e.target.value)}/>:<div className="monaco-host" ref={host}/>;
}
