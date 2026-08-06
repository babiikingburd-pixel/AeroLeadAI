import fs from 'node:fs';
const required = [
  'app/api/twincities/evidence-fusion/route.js',
  'app/api/twincities/apex-cycle/route.js',
  'lib/twincities/evidenceFusion.js',
  'supabase/migrations/20260805_apex99_fusion.sql',
  'supabase/migrations/20260805_apex100_autonomous_governance.sql',
  // The corrected leaderboard function. 20260805_apex100_global_rank.sql is
  // deliberately gone: it declared a different signature, so it left a second,
  // anon-callable SECURITY DEFINER copy behind instead of being replaced.
  'supabase/migrations/20260805b_apex100_global_rank_corrected.sql',
  'supabase/migrations/20260806_apex_governance_rls.sql',
  // APEX 10.1 — bounded autonomy.
  'lib/twincities/validationState.js',
  'lib/twincities/costGuard.js',
  'supabase/migrations/20260806b_apex101_controls_and_cost.sql',
  'supabase/migrations/20260806c_apex101_leaderboard_governance.sql'
];
const missing=required.filter(p=>!fs.existsSync(p));
if(missing.length){console.error('APEX10 missing:',missing);process.exit(1)}
console.log('APEX10 package integrity OK');
