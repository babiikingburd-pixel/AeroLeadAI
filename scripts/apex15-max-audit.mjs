import fs from "node:fs";
import path from "node:path";
const checks=[
 ["Apex priority config", "config/apex-roofing-priority.json"],
 ["Opportunity command", "lib/opportunityCommand.js"],
 ["Top10 API", "app/api/opportunities/top10/route.js"],
 ["Apex UI", "app/apex-roofing/page.jsx"],
 ["Top10 migration", "supabase/migrations/20260813_apex150_apex_roofing_top10.sql"],
 ["GateKeeper report", "APEX15.0_MAX_GATEKEEPER_COMMAND.md"]
];
let failed=0;
for(const [name,file] of checks){const ok=fs.existsSync(path.resolve(file));console.log(`${ok?"PASS":"FAIL"} ${name}: ${file}`);if(!ok)failed++;}
const cfg=JSON.parse(fs.readFileSync("config/apex-roofing-priority.json","utf8"));
for(const term of cfg.excluded_identity_terms){if(!cfg.display_name.toLowerCase().includes(term.toLowerCase().replace("llc","").trim())){} }
console.log(`Apex contractor priority rank: ${cfg.priority_rank}`);
console.log(`Excluded identities: ${cfg.excluded_identity_terms.join(", ")}`);
process.exitCode=failed?1:0;
