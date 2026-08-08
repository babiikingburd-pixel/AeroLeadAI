import fs from 'node:fs';
const required = [
  'app/api/twincities/evidence-fusion/route.js',
  'app/api/twincities/apex-cycle/route.js',
  'lib/twincities/evidenceFusion.js',
  'supabase/migrations/20260805_apex99_fusion.sql',
  'supabase/migrations/20260805_apex100_autonomous_governance.sql',
  'supabase/migrations/20260805_apex100_global_rank.sql'
];
const missing=required.filter(p=>!fs.existsSync(p));
if(missing.length){console.error('APEX10 missing:',missing);process.exit(1)}
console.log('APEX10 package integrity OK');
