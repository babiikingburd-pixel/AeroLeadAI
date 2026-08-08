import fs from "node:fs"; import path from "node:path";
const root=process.cwd();
const req=["app/api/twincities/predict-property/route.js","supabase/migrations/20260808_apex140_predictive_property.sql","APEX14.0_MAX_PREDICTIVE_PROPERTY_INTELLIGENCE.md"];
let fail=0; for(const f of req){if(fs.existsSync(path.join(root,f))) console.log("OK",f);else{console.error("MISSING",f);fail++;}}
const s=fs.readFileSync(path.join(root,req[1]),"utf8");
for(const x of ["property_predictions","maintenance_prediction","safety_prediction","opportunity_prediction"]) if(!s.includes(x)){console.error("MISSING TOKEN",x);fail++;}
console.log(fail?"AUDIT FAILED":"AUDIT PASSED: APEX 14.0 MAX");
process.exitCode=fail?1:0;
