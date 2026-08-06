#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = process.cwd();
const buildMode = process.argv.includes('--build');
let failures = 0;
const ok = (m) => console.log(`OK   ${m}`);
const warn = (m) => console.log(`WARN ${m}`);
const fail = (m) => { failures++; console.error(`FAIL ${m}`); };

const required = ['package.json','package-lock.json','next.config.mjs','app','components','lib','.env.example'];
for (const item of required) {
  const p = path.join(root,item);
  if (fs.existsSync(p)) ok(`required ${item}`); else fail(`missing ${item}`);
}

try {
  const v = process.versions.node.split('.').map(Number);
  if (v[0] >= 20) ok(`Node.js ${process.versions.node}`); else fail(`Node.js ${process.versions.node}; Node 20+ is required`);
} catch { fail('could not read Node.js version'); }

const pkg = JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
if (pkg.scripts?.build === 'next build') ok('npm build script is next build'); else fail('npm build script is missing or unexpected');
if (pkg.dependencies?.xlsx) ok('xlsx dependency present (lazy-imported by components/MassUploadConsole.jsx for batch export)'); else fail('xlsx missing but components/MassUploadConsole.jsx lazy-imports it — the production build will fail');

const lock = JSON.parse(fs.readFileSync(path.join(root,'package-lock.json'),'utf8'));
if (lock.packages?.['node_modules/xlsx']) ok('package-lock includes xlsx'); else fail('package-lock is missing xlsx — run npm install');

if (fs.existsSync(path.join(root,'node_modules','next','package.json'))) ok('installed Next.js dependency');
else if (buildMode) fail('Next.js dependency missing; run npm ci before building');
else warn('node_modules missing; run npm ci');

for (const f of ['install-windows.ps1','windows/Start-AeroLeadAI.ps1','windows/Stop-AeroLeadAI.ps1','windows/Uninstall-AeroLeadAI.ps1']) {
  if (fs.existsSync(path.join(root,f))) ok(`Windows lifecycle script ${f}`); else fail(`missing ${f}`);
}

if (process.platform === 'win32') {
  try { execFileSync('where.exe',['npm'],{stdio:'ignore'}); ok('npm is available on PATH'); }
  catch { fail('npm is not available on PATH'); }
}

if (failures) {
  console.error(`\nAeroLeadAI doctor: ${failures} failure(s).`);
  process.exit(1);
}
console.log('\nAeroLeadAI doctor: READY.');
