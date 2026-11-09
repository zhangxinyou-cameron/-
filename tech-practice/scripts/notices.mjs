import fs from 'node:fs';
import path from 'node:path';
const contents=[];
for(const entry of fs.readdirSync('node_modules',{withFileTypes:true})){
  const roots=entry.name.startsWith('@')?fs.readdirSync(path.join('node_modules',entry.name)).map(name=>path.join('node_modules',entry.name,name)):[path.join('node_modules',entry.name)];
  for(const root of roots){
    const pkg=path.join(root,'package.json');if(!fs.existsSync(pkg))continue;
    const p=JSON.parse(fs.readFileSync(pkg,'utf8'));
    const names=fs.readdirSync(root).filter(n=>/^(LICENSE|LICENCE|COPYING|NOTICE)(\.|$)/i.test(n));
    if(!names.length)continue;
    contents.push(`\n${'='.repeat(70)}\n${p.name} ${p.version} | ${typeof p.license==='string'?p.license:''}\n`);
    for(const name of names)if(fs.statSync(path.join(root,name)).isFile())contents.push(name+'\n'+fs.readFileSync(path.join(root,name),'utf8')+'\n');
  }
}
fs.writeFileSync('assets/THIRD_PARTY_NOTICES.txt',contents.join('\n'));
