import { build } from 'esbuild';
import fs from 'node:fs';
fs.mkdirSync('build', {recursive:true});
await build({entryPoints:['desktop/main.mjs'],outfile:'build/main.cjs',bundle:true,platform:'node',format:'cjs',target:'node24',mainFields:['module','main'],external:['electron'],sourcemap:true,logLevel:'info'});
fs.copyFileSync('desktop/install-update.ps1','build/install-update.ps1');
fs.copyFileSync('desktop/preload.cjs', 'build/preload.cjs');
fs.copyFileSync('desktop/startup-preload.cjs', 'build/startup-preload.cjs');
fs.cpSync('desktop/startup', 'build/startup', {recursive:true});
