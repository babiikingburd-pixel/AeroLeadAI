import fs from "node:fs";
const required=[
 "lib/intelligence/leadDecay.js",
 "lib/intelligence/missionEconomics.js",
 "lib/intelligence/outcomeCalibration.js",
 "lib/intelligence/futureOps.js",
 "lib/territory/opportunityCluster.js",
 "components/FutureOpsPanel.jsx",
 "app/api/future-ops/property/[id]/route.js",
 "supabase/migrations/20260816_unified_v92_future_ops.sql"
];
let bad=0;
for(const f of required){const ok=fs.existsSync(f)&&fs.statSync(f).size>0;console.log(ok?"OK ":"MISS",f);if(!ok)bad++;}
if(bad) process.exit(1);
console.log("AeroLeadAI Unified v9.2 structural audit passed.");
