import fs from "fs";
import path from "path";

const required = [
  "app/api/twincities/top500-network/route.js",
  "app/api/twincities/autonomous-cycle/route.js",
  "app/api/twincities/autonomous-top500/route.js",
  "workers/top500_crawler_network_worker.py",
  "supabase/migrations/20260808_apex141_top500_crawler_network.sql",
];

const missing = required.filter((p) => !fs.existsSync(path.join(process.cwd(), p)));
if (missing.length) {
  console.error("APEX 14.1 network audit FAILED — missing:", missing.join(", "));
  process.exit(1);
}

const route = fs.readFileSync(required[0], "utf8");
const sql = fs.readFileSync(required[4], "utf8");
const checks = [
  ["500-slot network", /top500_slots/.test(sql) && /between 1 and 500/.test(sql)],
  ["atomic task claim", /skip locked/i.test(sql) && /claim_top500_crawler_tasks/.test(sql)],
  ["persistent findings", /top500_crawler_findings/.test(sql)],
  ["residential gate", /residential_status/.test(route) && /excluded/.test(route)],
  ["permit history", /permit_history/.test(route) && /permit_number/.test(route)],
  ["imagery lane", /imagery-agent/.test(route)],
  ["damage lane", /damage-agent/.test(route)],
  ["competition lane", /competition/.test(route)],
  ["continuous external worker", fs.existsSync(path.join(process.cwd(), "workers/top500_crawler_network_worker.py"))],
];

const failed = checks.filter(([, ok]) => !ok);
for (const [name, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
if (failed.length) process.exit(1);
console.log("APEX 14.1 Top-500 crawler-network audit passed.");
