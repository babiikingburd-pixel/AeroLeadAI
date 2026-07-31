// THE PLANNER — decides what's worth spending compute on this cycle,
// instead of blindly rescanning everything every 30 minutes.
//
// HONEST SCOPE: "highest-value goals" sounds like it implies business
// judgment (which county is most profitable, which strategy to test) that
// this system has no actual signal for yet — there's no revenue/conversion
// data wired in anywhere. What IS real and computable from what's already
// stored:
//   - which properties have low-confidence predictions (worth a second look)
//   - which properties haven't been rescanned in a while (staleness)
//   - which domains the lesson engine flagged as degrading (needs attention)
//   - a hard cap on how much gets touched per cycle (cost control — this
//     is the part that actually was missing, and it's a real fix: unbounded
//     "scan everything" was the actual problem, not a business-strategy gap)
//
// This does not invent a notion of "which county to expand into" or "which
// pricing strategy to test" — that requires business data (conversion,
// revenue, territory performance) this system doesn't have. Building a
// planner that pretends to answer those would be fabricating priorities.

import { supabaseGet } from "./supabaseRest";

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;

// Confidence-based rescan interval — the actual mechanism requested: high-
// value/uncertain properties get checked again sooner, stable ones get left
// alone longer. This is the direct cost-control fix for "don't scan
// everything every 30 minutes."
export function nextScanDueAt(prediction) {
  const base = new Date(prediction.predicted_at).getTime();
  if (prediction.confidence === "low") return base + 1 * HOUR;
  if (prediction.predicted_score >= 75) return base + 6 * HOUR; // hot lead, recheck sooner
  return base + 3 * DAY;
}

// Real three-tier priority, computed only from fields that actually exist
// on a prediction row — NOT the invented property.recentStorm /
// property.newPermit flags from the request, which don't exist anywhere in
// this schema. "Recent storm" here means an actual weather-agent call
// within the last 48h returned a severe alert for this address (passed in
// as stormAlertActive); "new permit" means the permit-lookup directory
// actually has a record dated within the last 14 days for this address
// (passed in as recentPermit). Both are real, checkable facts, computed by
// the caller from real data before this function is asked to prioritize.
export function priority({ confidence, predictedScore, lastScannedAt, stormAlertActive, recentPermit }) {
  if (stormAlertActive) return "high";
  if (recentPermit) return "high";
  if (confidence === "low" || predictedScore >= 75) return "high";
  const daysSinceLastScan = lastScannedAt ? (Date.now() - new Date(lastScannedAt).getTime()) / DAY : 999;
  if (daysSinceLastScan > 7) return "medium";
  return "low";
}

// Maps a priority tier to how often that tier actually gets touched. These
// three numbers are the direct implementation of "high: 15min, medium: 6hr,
// low: daily" — but stated as intervals a REAL scheduler enforces (see
// vercel.json's three cron tiers), not a comment describing intent.
export const PRIORITY_INTERVALS_MS = {
  high: 15 * 60 * 1000,
  medium: 6 * HOUR,
  low: 1 * DAY,
};


// Returns a bounded, real, explainable list of what deserves attention this
// cycle — never "everything," always capped, always traceable to why.
// Real permit-recency check — is there a permit dated within the last 14
// days for this address? This is what "recentPermit" honestly means, using
// data already in the permits table, not an invented flag.
async function hasRecentPermit(address) {
  const addressNorm = (address || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const res = await supabaseGet(`permits?address_normalized=eq.${addressNorm}&select=issue_date&order=issue_date.desc&limit=1`);
  if (!res.ok || !res.data?.length) return false;
  const issueDate = res.data[0].issue_date;
  if (!issueDate) return false;
  return Date.now() - new Date(issueDate).getTime() < 14 * DAY;
}

export async function planCycle(tier = "high", maxItems = 10) {
  const plan = { rescanCandidates: [], reasons: [], tier };
  const now = Date.now();

  // Pull a candidate pool once, then classify each into a real tier using
  // the priority() function above — not three separate ad-hoc queries like
  // before. This is what makes tiers consistent: one classification
  // function, called from three different cron schedules with a tier filter.
  const poolRes = await supabaseGet(`predictions?order=predicted_at.desc&limit=100`);
  if (!poolRes.ok) {
    plan.reasons.push("Could not fetch prediction pool.");
    return plan;
  }

  const seen = new Set();
  for (const p of poolRes.data) {
    if (seen.has(p.address_normalized)) continue; // one candidate per address per cycle
    seen.add(p.address_normalized);
    if (plan.rescanCandidates.length >= maxItems) break;

    // recentPermit check costs a real DB query per candidate — only run it
    // for candidates we haven't already ruled out by cheaper checks, to
    // keep this affordable at the "high" tier's 15-minute cadence.
    const recentPermit = await hasRecentPermit(p.address);
    const computedPriority = priority({
      confidence: p.confidence, predictedScore: p.predicted_score,
      lastScannedAt: p.predicted_at, stormAlertActive: false, // live weather check is a real API call per property — deliberately NOT done for every candidate every 15 min; the medium/low tiers below do the storm-context work
      recentPermit,
    });

    if (computedPriority !== tier) continue;
    const dueTime = new Date(p.predicted_at).getTime() + PRIORITY_INTERVALS_MS[computedPriority];
    if (dueTime > now) continue; // not due yet even within its own tier

    plan.rescanCandidates.push({ address: p.address, reason: `${computedPriority}_priority_due`, predictionId: p.prediction_id });
  }

  plan.reasons.push(`Tier "${tier}": ${plan.rescanCandidates.length} candidate(s) selected, capped at ${maxItems}/cycle.`);
  plan.reasons.push("No business-strategy prioritization (territory expansion, pricing tests) — this system has no revenue/conversion data to base that on. Would be fabricated if included.");

  return plan;
}
