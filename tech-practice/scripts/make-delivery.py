from pathlib import Path
import hashlib
import json
import shutil
import zipfile

root=Path(__file__).resolve().parents[1]
parent=root.parent
portable=root/'release'/'TechPractice-win32-x64'
outputs=[]
version=json.loads((root/'package.json').read_text(encoding='utf-8'))['version']

def archive(file, entries):
    with zipfile.ZipFile(file,'w',zipfile.ZIP_DEFLATED,compresslevel=4) as z:
        for source,name in entries:
            z.write(source,name)
    with zipfile.ZipFile(file) as z:
        assert z.testzip() is None
    digest=hashlib.sha256(file.read_bytes()).hexdigest()
    outputs.append({'file':file.name,'bytes':file.stat().st_size,'sha256':digest})

archive(parent/f'知习-v{version}-Windows-x64.zip',[(p,Path('TechPractice')/p.relative_to(portable)) for p in sorted(portable.rglob('*')) if p.is_file()])
sources=[]
for folder in ['src','desktop','scripts','tests','assets','launcher']:
    sources += [(p,Path('tech-practice')/p.relative_to(root)) for p in sorted((root/folder).rglob('*')) if p.is_file() and '__pycache__' not in p.parts]
for name in ['package.json','package-lock.json','tsconfig.json','vite.config.ts','index.html','README.md','TEST_REPORT.md','STARTUP_TEST_REPORT.md','.npmrc','.gitignore']:
    sources.append((root/name,Path('tech-practice')/name))
archive(parent/f'知习-v{version}-源码.zip',sources)
shutil.copy2(root/'test-results'/'ui'/'01-home.png',parent/'知习界面预览.png')
(parent/f'知习-v{version}-交付校验.json').write_text(json.dumps(outputs,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps(outputs,ensure_ascii=True))
