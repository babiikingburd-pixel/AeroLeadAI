import fs from "node:fs";
import path from "node:path";

const root=process.cwd();
const required=[
 "app/api/image-crawler/route.js",
 "app/api/twincities/autonomous-top500/route.js",
 "app/api/twincities/property-intelligence/route.js",
 "app/api/twincities/recheck-planner/route.js",
 "supabase/migrations/20260808_apex130_property_intelligence.sql",
 "APEX13.0_MAX_ARCHITECTURE.md"
];
let failures=0;
for(const rel of required){
 if(fs.existsSync(path.join(root,rel))) console.log("OK",rel);
 else { console.error("MISSING",rel); failures++; }
}
const migration=fs.readFileSync(path.join(root,"supabase/migrations/20260808_apex130_property_intelligence.sql"),"utf8");
for(const token of ["property_findings","property_relationships","property_state_snapshots","evidence_rechecks"]){
 if(!migration.includes(token)){console.error("FAIL",token);failures++;}
}
console.log(failures?"AUDIT FAILED":"AUDIT PASSED: APEX 13.0 MAX static audit");
process.exitCode=failures?1:0;
