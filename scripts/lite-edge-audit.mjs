import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { buildEvidenceLedger, fingerprintEvidence, rankEvidenceTwins, scoreEvidenceTwin } from "../lib/lite/evidenceTwin.mjs";
import { CEDAR_SPIRAL_SEED, normalizeHennepinParcel } from "../lib/lite/minnesotaSpiralSeed.mjs";

const root = process.cwd();
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const walkFiles = (relativeDirectory, extensions = new Set([".js", ".jsx", ".mjs", ".ts", ".tsx"])) => {
  const directory = path.join(root, relativeDirectory);
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const relativePath = path.join(relativeDirectory, entry.name);
    if (entry.isDirectory()) return walkFiles(relativePath, extensions);
    return extensions.has(path.extname(entry.name)) ? [relativePath] : [];
  });
};
const base = {
  id: "mn-1",
  address: "4300 Interlachen Boulevard",
  city: "Edina",
  county: "hennepin",
  state: "MN",
  lat: 44.91,
  lon: -93.34,
  property_class: "single family residential",
  residential_status: "verified",
  residential_confidence: 95,
  year_built: 1992,
  assessed_value: 650000,
  permit_evidence_status: "none_found",
  permit_within_10y: false,
  permit_checked_at: new Date().toISOString(),
  storm_evidence_status: "verified",
  storm_checked_at: new Date().toISOString(),
  hail_inches: 1.5,
  wind_mph: 72,
  sales_status: "new",
  review_status: "pending",
  updated_at: new Date().toISOString(),
};

const provisional = scoreEvidenceTwin(base);
assert.equal(provisional.eligible, true);
assert.notEqual(provisional.opportunityScore, provisional.evidenceConfidence, "opportunity and evidence confidence must remain separate outputs");
assert.equal(provisional.scoreStatus, "PROVISIONAL");
assert.ok(provisional.evidencePlan.some((item) => item.lane === "imagery"), "missing imagery must create a planned probe");

const image = {
  property_id: base.id,
  provider: "google",
  view: "overview_tight",
  storage_path: "imagery/mn-1/latest/overview_tight.jpg",
  quality_score: 92,
  evidence_status: "verified",
  fetched_at: new Date().toISOString(),
};
const reviewed = scoreEvidenceTwin({ ...base, image_review_status: "verified", image_review_confidence: 90, roof_visual_score: 78 }, { images: [image] });
assert.ok(reviewed.evidenceConfidence > provisional.evidenceConfidence, "reviewed imagery must raise confidence");
assert.ok(reviewed.rankScore > provisional.rankScore, "verified imagery must strengthen ranking");

const contradictionFindings = [
  { claim: "roof_concern", source: "human-review", polarity: "positive", verification_status: "verified", confidence: 95, evidence: { score: 80 } },
  { claim: "roof_concern", source: "second-review", polarity: "negative", verification_status: "verified", confidence: 95, evidence: { score: 10 } },
];
const contradicted = scoreEvidenceTwin({ ...base, image_review_status: "verified", roof_visual_score: 78 }, { images: [image], findings: contradictionFindings });
assert.equal(contradicted.classification, "CONTRADICTED");
assert.equal(contradicted.scoreStatus, "PROVISIONAL");
assert.ok(contradicted.penalties.some((item) => item.reason.includes("contradiction")));

const recentPermit = scoreEvidenceTwin({ ...base, id: "mn-2", permit_within_10y: true, permit_evidence_status: "verified" });
assert.ok(recentPermit.rankScore < provisional.rankScore, "a recent permit must reduce replacement urgency");

const outsideMinnesota = scoreEvidenceTwin({ ...base, id: "wi-1", state: "WI", lat: 44.9, lon: -92.1 });
assert.equal(outsideMinnesota.eligible, false);
assert.equal(outsideMinnesota.rankScore, 0);

const unknownGeography = scoreEvidenceTwin({ ...base, id: "unknown-geo", state: null, lat: null, lon: null, zip: null });
assert.equal(unknownGeography.eligible, false, "unverified geography must not enter the Minnesota leaderboard");
assert.equal(unknownGeography.breakdown.confidence.identity.score, 10, "null coordinates must not be coerced to zero coordinates");

const apartment = scoreEvidenceTwin({ ...base, id: "apt-1", property_class: "apartment building" });
assert.equal(apartment.eligible, false);

assert.equal(CEDAR_SPIRAL_SEED.inputAddress, "8600 Cedar Ave S, Bloomington, MN 55425");
const hennepinFixture = {
  PID: "0102724340006",
  HOUSE_NO: 2100,
  FRAC_HOUSE_NO: "",
  STREET_NM: "86TH ST E",
  ZIP_CD: "55425",
  MUNIC_NM: "BLOOMINGTON",
  BUILD_YR: "1930",
  PR_TYP_NM1: "RESIDENTIAL",
  MKT_VAL_TOT: 219300,
  MULTI_ADDR_IND: "",
  CONDO_NO: "",
  PROPERTY_STATUS_CD: "0",
  LAT: 44.848293,
  LON: -93.242662,
};
const cedarParcel = normalizeHennepinParcel(hennepinFixture, "2026-08-20T00:00:00.000Z");
assert.equal(cedarParcel?.address, "2100 86TH ST E");
assert.equal(cedarParcel?.residential_status, "verified");
assert.equal(cedarParcel?.spiral_seed_id, "cedar-8600");
assert.equal(normalizeHennepinParcel({ ...hennepinFixture, PID: "apt", PR_TYP_NM1: "APARTMENT" }), null);
assert.equal(normalizeHennepinParcel({ ...hennepinFixture, PID: "condo", CONDO_NO: "101" }), null);
assert.equal(normalizeHennepinParcel({ ...hennepinFixture, PID: "seed", HOUSE_NO: 8600, STREET_NM: "OLD CEDAR AVE S" }), null);

assert.equal(fingerprintEvidence({ b: 2, a: 1 }), fingerprintEvidence({ a: 1, b: 2 }), "fingerprints must be deterministic");
const ledger = buildEvidenceLedger(base, [{ ...image, dataUrl: "data:image/jpeg;base64,AAAA" }]);
assert.ok(!JSON.stringify(ledger).includes("data:image"), "evidence ledger must never retain image bytes");

const sample = Array.from({ length: 620 }, (_, index) => ({
  ...base,
  id: `rank-${index + 1}`,
  address: `${1000 + index} Test Avenue`,
  year_built: 1970 + (index % 40),
  assessed_value: 250000 + index * 1000,
  hail_inches: (index % 5) * 0.4,
  image_review_status: index < 80 ? "verified" : "pending",
  image_fetched_at: index < 180 ? new Date().toISOString() : null,
  roof_visual_score: index < 80 ? 70 + (index % 20) : null,
}));
const ranked = rankEvidenceTwins(sample);
assert.equal(ranked.filter((row) => row.liteTier === "TOP20").length, 20);
assert.ok(ranked.slice(0, 20).every((row) => row.evidenceTwin.scoreStatus === "CERTIFIED"), "every Top 20 profile must be fully certified");
assert.equal(ranked.filter((row) => row.liteTier === "TOP100").length, 80);
assert.equal(ranked.filter((row) => row.liteTier === "TOP500").length, 400);
assert.equal(ranked[0].liteRank, 1);
assert.ok(ranked.slice(0, 100).some((row) => row.selectionTrack === "CHALLENGER"), "Top 100 must reserve challenger capacity");
assert.ok(ranked[0].evidenceTwin.evidencePlan.every((item) => item.priority >= 0));

const securityFiles = {
  server: read("lib/supabaseServer.js"),
  authGate: read("components/AuthGate.jsx"),
  imagery: read("app/api/imagery-agent/route.js"),
  continuousScan: read("app/api/scan/continuous/route.js"),
  scoreRefresh: read("lib/lite/scoreRefresh.mjs"),
  spiralSeed: read("lib/lite/minnesotaSpiralSeed.mjs"),
  spiralMigration: read("supabase/migrations/20260820f_cedar_spiral_frontier.sql"),
  spiralCompatibility: read("supabase/migrations/20260820g_cedar_spiral_compatibility.sql"),
  boundedCrawlerQueue: read("supabase/migrations/20260820h_bounded_crawler_queue.sql"),
  taskCompletionMigration: read("supabase/migrations/20260820i_normalize_task_completion.sql"),
  top500Network: read("app/api/twincities/top500-network/route.js"),
  leaderboardCron: read("app/api/cron/apex-leaderboard/route.ts"),
};
assert.ok(!/SUPABASE_ANON_KEY|PUBLISHABLE_KEY/.test(securityFiles.server), "server client must not fall back to public keys");
const browserSource = walkFiles("components").map(read).join("\n");
assert.ok(!/aero2026/i.test(browserSource), "browser bundle must not contain the legacy shared password");
const serverDataPlane = [
  ...walkFiles("app/api"),
  "lib/supabaseServer.js",
  "lib/supabaseRest.js",
  "lib/propertyIntelligenceV1/supabaseRest.js",
  "utils/supabase/server.ts",
].map(read).join("\n");
assert.ok(
  !/(?:SUPABASE_SECRET_KEY|SUPABASE_SERVICE_ROLE_KEY)[^\n]*\|\|[^\n]*(?:ANON_KEY|PUBLISHABLE_KEY)/.test(serverDataPlane),
  "server data plane must never fall back from a secret/service key to a public key"
);
assert.ok(!/imagery_cache|imagery_history/.test(securityFiles.imagery), "imagery route must not write base64 cache/history tables");
assert.ok(!/ANTHROPIC|fictional residential lead/i.test(securityFiles.continuousScan), "manual scans must never synthesize properties");
assert.ok(securityFiles.continuousScan.includes("synthetic: false"), "manual scans must explicitly identify real indexed data");
assert.ok(securityFiles.scoreRefresh.includes("lite_begin_score_refresh"), "daily scoring must remove stale score incumbents");
assert.ok(securityFiles.scoreRefresh.includes("lite_cancel_stale_top500_tasks"), "rank replacements must cancel stale crawler jobs");
assert.ok(securityFiles.scoreRefresh.includes("lite_prune_compact_data"), "daily scoring must enforce bounded evidence retention");
assert.ok(securityFiles.spiralSeed.includes("PR_TYP_NM1 = 'RESIDENTIAL'"), "spiral import must query exact single-family parcels");
assert.ok(securityFiles.spiralSeed.includes("8600 Cedar Ave S"), "spiral import must retain the user-selected map origin");
assert.ok(securityFiles.spiralMigration.includes("lite_prune_spiral_candidates"), "spiral candidates must be bounded to prevent another database freeze");
assert.ok(securityFiles.spiralMigration.includes("revoke all privileges"), "spiral state must remain owner-only");
assert.ok(securityFiles.spiralCompatibility.includes("parcel_id text"), "clean recovery schema must retain parcel route compatibility");
assert.ok(securityFiles.boundedCrawlerQueue.includes("ux_top500_tasks_one_active_lane"), "crawler queue must enforce one active task per property lane");
assert.ok(securityFiles.boundedCrawlerQueue.includes("task.status in ('queued', 'running')"), "overdue queued tasks must not be duplicated daily");
assert.ok(securityFiles.taskCompletionMigration.includes("status = 'completed'"), "historical crawler completion statuses must become retainable");
assert.ok(!/status:\s*["']complete["']/.test(securityFiles.top500Network), "crawler workers must use the retention-compatible completed status");
assert.ok(securityFiles.top500Network.includes('rankingEngine: "lite_evidence_twin"'), "network pulse must preserve the canonical Lite ranking");
assert.ok(securityFiles.top500Network.includes("Promise.all((tasks||[]).map"), "bounded crawler claims must run concurrently within Hobby's timeout");
assert.ok(securityFiles.top500Network.includes("lite:true,force:false"), "bulk imagery must use the fast cached overhead path");
assert.ok(securityFiles.leaderboardCron.includes("seedCedarSpiral"), "daily leaderboard cron must advance the Cedar spiral before scoring");
assert.ok(securityFiles.leaderboardCron.includes("p_keep: LEADERBOARD_LIMIT"), "daily leaderboard cron must retain only the Top 500 spiral candidates");

const vercel = JSON.parse(read("vercel.json"));
const leaderboardCron = vercel.crons?.find((entry) => entry.path === "/api/cron/apex-leaderboard");
assert.equal(leaderboardCron?.schedule, "0 0 * * *", "Lite leaderboard must remain Hobby-safe at once per day");
assert.ok(vercel.crons.every((entry) => /^\d{1,2} \d{1,2} \* \* \*$/.test(entry.schedule)), "every Hobby cron must run no more than daily");

console.log("AUDIT PASSED: AeroLeadAI Lite Evidence Twin, private access, and compact imagery invariants");
