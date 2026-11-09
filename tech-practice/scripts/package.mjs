import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const out = path.resolve('release/TechPractice-win32-x64');
fs.mkdirSync(out, { recursive: true });
const exe = path.join(out, 'TechPractice.exe');
const digest = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
if (!fs.existsSync(exe) || digest(exe) !== digest('node_modules/electron/dist/electron.exe')) {
  fs.cpSync('node_modules/electron/dist', out, { recursive: true });
  if (fs.existsSync(exe)) fs.unlinkSync(exe);
  fs.renameSync(path.join(out, 'electron.exe'), exe);
}
const app = path.join(out, 'resources/app'); fs.mkdirSync(app, { recursive: true });
for (const name of ['build','dist','assets']) fs.cpSync(name, path.join(app,name), {recursive:true});
const pkg = JSON.parse(fs.readFileSync('package.json','utf8'));
fs.writeFileSync(path.join(app,'package.json'), JSON.stringify({name:'tech-practice',version:pkg.version,main:'build/main.cjs',productName:'知习'}));
fs.copyFileSync('build/知习.exe',path.join(out,'知习.exe'));
fs.copyFileSync('build/知习.exe',path.resolve('../知习.exe'));
fs.writeFileSync(path.join(out, '使用说明.md'), fs.readFileSync('README.md','utf8').replace('双击工作区的 `知习.exe`，或 release/TechPractice-win32-x64/知习.exe。','双击本文件夹中的 `知习.exe`。'));
if (fs.existsSync('TEST_REPORT.md')) fs.copyFileSync('TEST_REPORT.md', path.join(out, 'TEST_REPORT.md'));
if (fs.existsSync('STARTUP_TEST_REPORT.md')) fs.copyFileSync('STARTUP_TEST_REPORT.md', path.join(out, 'STARTUP_TEST_REPORT.md'));
if (fs.existsSync('LEARNING_TEST_REPORT.md')) fs.copyFileSync('LEARNING_TEST_REPORT.md', path.join(out, 'LEARNING_TEST_REPORT.md'));
for (const name of ['学习资料协议.md','插件开发协议.md']) {
  const file=path.resolve('../docs',name);
  if(fs.existsSync(file))fs.copyFileSync(file,path.join(out,name));
}
fs.copyFileSync('assets/learnpack-demo.json',path.join(out,'learnpack-demo.json'));
fs.writeFileSync(path.join(out, '启动知习.cmd'), '@echo off\r\nstart "" "%~dp0知习.exe"\r\n');
console.log(exe);
