import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
if (process.platform !== 'win32') { console.log('Windows launcher compilation skipped on this platform.'); process.exit(0); }
const windows = process.env.WINDIR || 'C:/Windows';
const compiler = ['Framework64', 'Framework'].map(dir => path.join(windows, 'Microsoft.NET', dir, 'v4.0.30319', 'csc.exe')).find(f => fs.existsSync(f));
if (!compiler) throw new Error('未找到 Windows .NET Framework C# 编译器，无法构建知习启动器。');
fs.mkdirSync('build', { recursive: true });
execFileSync(compiler, ['/nologo', '/target:winexe', '/platform:anycpu', '/optimize+', '/codepage:65001', '/reference:System.Windows.Forms.dll', '/reference:System.Core.dll', '/win32icon:' + path.resolve('assets/icon.ico'), '/out:' + path.resolve('build/知习.exe'), path.resolve('launcher/Program.cs')], { windowsHide: true, stdio: 'pipe' });
console.log('Built ' + path.resolve('build/知习.exe'));
