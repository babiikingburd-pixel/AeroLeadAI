import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const required = [
  "app/api/image-crawler/route.js",
  "app/api/twincities/evidence-cycle/route.js",
  "app/api/twincities/autonomous-top500/route.js",
  "app/api/twincities/evidence-dossier/route.js",
  "lib/twincities/evidenceEvents.js",
  "lib/twincities/priorityEngine.js",
  "supabase/migrations/20260808_apex102_evidence_pipeline.sql",
  "supabase/migrations/20260808_apex103_complete_evidence.sql",
  "supabase/migrations/20260808_apex110_autonomous_evidence.sql"
];

let failures = 0;
for (const rel of required) {
  if (!fs.existsSync(path.join(root, rel))) {
    console.error("MISSING", rel); failures++;
  } else console.log("OK", rel);
}

const image = fs.readFileSync(path.join(root,"app/api/image-crawler/route.js"),"utf8");
if (!image.includes("Promise.any")) { console.error("FAIL provider race"); failures++; }
if (!image.includes("property-images")) { console.error("FAIL image storage"); failures++; }

const evidence = fs.readFileSync(path.join(root,"lib/twincities/evidenceEvents.js"),"utf8");
for (const token of ["evidencePatch.assessed_value","evidencePatch.hail_inches","evidence_score_breakdown"]) {
  if (!evidence.includes(token)) { console.error("FAIL missing scoring token",token); failures++; }
}

console.log(failures ? `AUDIT FAILED: ${failures}` : "AUDIT PASSED: APEX 11.1 MAX static checks");
process.exitCode = failures ? 1 : 0;
