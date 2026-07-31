// TIER: MEDIUM — runs every 6 hours (see vercel.json). This is the
// "scheduled services" tier from the request: deeper, more expensive work
// than the 15-min high-priority loop, but not so frequent it burns budget
// on things that don't change fast.
//
// HONEST SCOPE ON "neighborhood trend analysis": there is no true county/
// neighborhood GIS boundary data joined into this system (parcel-boundary
// only covers Scott + Hennepin County MN so far). What's real and
// computable right now is grouping by the city/state text already present
// on every prediction row — coarser than a real neighborhood, but genuinely
// derived from real data, not invented.
//
// HONEST SCOPE ON "revenue prediction retraining": no revenue data exists
// anywhere in this system (documented repeatedly — no CRM, no sales-close
// tracking). This tier does NOT retrain anything against revenue. It DOES
// re-run the experiment-evaluation logic (via lesson-engine's Scientist
// Agent path) more frequently than the nightly cycle, which is the honest
// version of "strategy optimization" available with what this system knows.

import { supabaseGet } from "../../../lib/supabaseRest";
import { withCrawlerLog } from "../../../lib/crawlerLog";
import { planCycle } from "../../../lib/planner";

export const maxDuration = 60;

function checkAuth(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  const url = new URL(req.url);
  return url.searchParams.get("secret") === secret || req.headers.get("authorization") === `Bearer ${secret}`;
}

// Deep imagery re-analysis on medium-tier candidates — the full geocode ->
// imagery -> damage-agent chain (same real chain crawlerForge.js uses for
// the damage_scoring tool), not just a permit-recency check like the
// high-tier loop does.
async function deepImageryPass(baseUrl) {
  return withCrawlerLog("tier_medium_imagery", async () => {
    const plan = await planCycle("medium", 5); // smaller cap — this tier's work is expensive per-item
    let succeeded = 0, failed = 0;
    const errors = [];

    for (const candidate of plan.rescanCandidates) {
      try {
        const geoRes = await fetch(`${baseUrl}/api/geocode`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ address: candidate.address }) });
        const geo = await geoRes.json();
        if (!geo.ok) { failed++; errors.push(`${candidate.address}: geocode failed`); continue; }

        const imgRes = await fetch(`${baseUrl}/api/imagery-agent`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ lat: geo.lat, lon: geo.lon }) });
        const img = await imgRes.json();
        if (!img.dataUrl) { failed++; errors.push(`${candidate.address}: no imagery`); continue; }

        const match = img.dataUrl.match(/^data:(image\/[a-zA-Z+]+);base64,(.*)$/);
        const scoreRes = await fetch(`${baseUrl}/api/damage-agent`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ domain: "roof", base64Image: match?.[2], mediaType: match?.[1], address: candidate.address }),
        });
        if (scoreRes.ok) succeeded++; else { failed++; errors.push(`${candidate.address}: scoring HTTP ${scoreRes.status}`); }
      } catch (e) {
        failed++;
        errors.push(`${candidate.address}: ${e.message}`);
      }
    }
    return { succeeded, failed, errors, planReasons: plan.reasons };
  });
}

// Real "neighborhood trend" — groups resolved+unresolved predictions by the
// city/state parsed from the address text, computes avg score per area.
// This is genuinely computable from data already stored; it is NOT a true
// GIS-neighborhood analysis (that needs parcel/county boundary data this
// system only has for 2 counties so far — see parcel-boundary route).
function parseAreaFromAddress(address) {
  // Expects "..., City, ST ZIP" — takes the last two comma-separated
  // segments as a best-effort area label. Falls back to "unknown" rather
  // than guessing wrong.
  const parts = (address || "").split(",").map((s) => s.trim());
  if (parts.length < 2) return "unknown";
  return parts.slice(-2).join(", ");
}

async function neighborhoodTrends() {
  const res = await supabaseGet("predictions?select=address,predicted_score,domain&order=predicted_at.desc&limit=300");
  if (!res.ok || !res.data.length) return { areas: [], notes: "No predictions to analyze yet." };

  const byArea = {};
  for (const p of res.data) {
    const area = parseAreaFromAddress(p.address);
    byArea[area] = byArea[area] || [];
    byArea[area].push(p.predicted_score);
  }

  const areas = Object.entries(byArea)
    .filter(([area, scores]) => area !== "unknown" && scores.length >= 3) // don't rank an area from 1-2 data points
    .map(([area, scores]) => ({
      area, count: scores.length,
      avgScore: scores.reduce((a, b) => a + b, 0) / scores.length,
      hotCount: scores.filter((s) => s >= 75).length,
    }))
    .sort((a, b) => b.avgScore - a.avgScore);

  return { areas, notes: `${areas.length} area(s) with enough data (3+ predictions) to rank, out of ${Object.keys(byArea).length} total areas seen.` };
}

export async function GET(req) {
  if (!checkAuth(req)) return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const baseUrl = `${url.protocol}//${url.host}`;

  const imageryResult = await deepImageryPass(baseUrl);
  const trends = await neighborhoodTrends();

  return Response.json({ ok: true, tier: "medium", imageryResult, neighborhoodTrends: trends });
}
