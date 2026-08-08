#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
const root=process.cwd();
const required=['lib/apex/releaseTrain.js','app/apex/page.jsx','app/api/apex-status/route.js','windows/build-windows.ps1','windows/Start-AeroLeadAI.ps1','android/build-aeroleadai.sh'];
let bad=0;
for(const f of required){ if(fs.existsSync(path.join(root,f))) console.log(`PASS ${f}`); else {console.error(`FAIL ${f}`);bad++;} }
const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
if(pkg.version!=='1.10.0-apex10.0'){console.error('FAIL package version');bad++;} else console.log('PASS package version APEX10.0');
console.log(bad?`\nAPEX release check failed: ${bad}`:'\nAPEX release check: READY');
process.exit(bad?1:0);
