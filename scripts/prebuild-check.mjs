#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const requiredRoutes = [
  'app/api/lead-score',
  'app/api/imagery-agent',
  'app/api/damage-agent',
  'app/api/verify-agent',
  'app/api/weather-agent'
];
let bad = 0;
for (const rel of requiredRoutes) {
  const p = path.join(root, rel);
  if (fs.existsSync(p)) console.log(`OK   route ${rel}`);
  else { console.error(`FAIL route ${rel}`); bad++; }
}
if (!fs.existsSync(path.join(root,'.env.local'))) {
  console.log('INFO .env.local not present; build is allowed, runtime keys are validated at request time.');
}
if (bad) process.exit(1);
