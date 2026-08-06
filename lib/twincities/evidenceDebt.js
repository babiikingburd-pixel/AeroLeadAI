// lib/twincities/evidenceDebt.js
//
// EVIDENCE DEBT + PROMOTION GATING
//
// The problem this solves: priority_score answers "how attractive would this
// lead be IF the evidence held up." It does not answer "have we actually
// checked." Those got conflated, so the Top 500 ranked on year_built +
// assessed_value alone at confidence 18 and nothing was ever validated.
//
// This module adds two things and deliberately nothing else:
//
//   1. Evidence debt — a property's rank creates an obligation to validate it.
//      The highest-ranked, least-validated property is the system's most
//      urgent job, because it is the one whose position is least earned.
//
//   2. A confidence floor — nothing reaches the human review queue until its
//      rank is actually backed by evidence.
//
// This is NOT a second scoring engine. It never computes a priority score and
// never writes one. It orders work and gates visibility. Every score change
// still goes through applyEvidenceAndRescore() -> calculatePriority(), exactly
// as before. That separation is the whole point: one definition of "priority,"
// one definition of "what to work on next."

// ---------------------------------------------------------------------------
// Evidence states. These already exist across priority-worker, gap-router,
// validation-worker and fastCycle; this centralizes the truth table so no
// future caller reinvents it (and gets it subtly wrong).
//
//   unknown    -> never attempted. NOT a negative signal.
//   failed     -> attempted, errored out. Retry-able. NOT a negative signal.
//   none_found -> attempted, completed, genuinely nothing there. RESOLVED.
//   found      -> attempted, records returned, not yet corroborated.
//   verified   -> attempted, records returned, corroborated.
//
// The distinction that matters: `unknown` and `failed` are open questions.
// `none_found` is an answer. A property with no permit on file is a BETTER
// lead than one we simply never checked — treating those the same is how a
// system talks itself into confidence it hasn't earned.
// ---------------------------------------------------------------------------
export const RESOLVED_STATES = new Set(["found", "verified", "none_found"]);
export const OPEN_STATES = new Set(["unknown", "failed"]);

export function isResolved(status) {
  return RESOLVED_STATES.has(status);
}

/** True only when a lookup ran to completion and legitimately found nothing. */
export function ranAndFoundNothing(status) {
  return status === "none_found";
}

// ---------------------------------------------------------------------------
// Evidence dimensions, weighted by how much they can move a ranking and what
// they cost to obtain. Cost is here so the queue can prefer a free answer over
// a paid one when both resolve comparable uncertainty.
// ---------------------------------------------------------------------------
export const EVIDENCE_DIMENSIONS = [
  { key: "storm",  column: "storm_evidence_status",  weight: 30, cost: "free",   note: "NOAA SWDI bulk backfill" },
  { key: "permit", column: "permit_evidence_status", weight: 30, cost: "paid",   note: "Shovels.ai, per-lookup billing" },
  { key: "image",  column: "image_evidence_status",  weight: 25, cost: "medium", note: "imagery fetch + damage-agent vision" },
  { key: "value",  column: "value_evidence_status",  weight: 15, cost: "low",    note: "county assessor" },
];

const TOTAL_WEIGHT = EVIDENCE_DIMENSIONS.reduce((s, d) => s + d.weight, 0);

/** Which evidence dimensions are still open questions for this row. */
export function missingEvidence(row) {
  return EVIDENCE_DIMENSIONS.filter((d) => !isResolved(row[d.column]));
}

/**
 * Evidence debt — how badly this property's rank outruns its evidence.
 *
 *   evidenceDebt = rankUrgency x missingEvidenceWeight x confidenceGap
 *
 * A #1 at confidence 18 with nothing checked scores near the maximum: it is
 * simultaneously the most visible and the least substantiated claim the system
 * is making. A #400 at confidence 75 with permit and storm resolved scores near
 * zero — spending another call there buys almost nothing.
 *
 * Returns 0-100 plus the reasoning, so the queue can explain its own ordering
 * rather than emitting an opaque number.
 */
export function calculateEvidenceDebt(row, { maxScore = 100, confidenceFloor = 60 } = {}) {
  const missing = missingEvidence(row);

  // Nothing left to ask -> no debt, regardless of rank.
  if (missing.length === 0) {
    return { debt: 0, missing: [], rankUrgency: 0, confidenceGap: 0, cheapestNext: null, reasons: ["All evidence dimensions resolved"] };
  }

  // Rank urgency: normalized priority score. High-ranked unvalidated leads are
  // the urgent ones — that is the entire premise.
  const rankUrgency = Math.min((row.priority_score ?? 0) / maxScore, 1);

  // How much of the evidence picture is missing, by weight not by count.
  const missingWeight = missing.reduce((s, d) => s + d.weight, 0) / TOTAL_WEIGHT;

  // Distance from the confidence we require before a human sees this.
  const confidence = row.confidence_score ?? 0;
  const confidenceGap = Math.max(confidenceFloor - confidence, 0) / confidenceFloor;

  const debt = Math.round(rankUrgency * missingWeight * confidenceGap * 100);

  // Cheapest unresolved dimension first: never spend a paid lookup to answer a
  // question a free one can close. Ties break toward the heavier weight.
  const costRank = { free: 0, low: 1, medium: 2, paid: 3 };
  const cheapestNext = [...missing].sort(
    (a, b) => (costRank[a.cost] - costRank[b.cost]) || (b.weight - a.weight)
  )[0];

  const reasons = [
    `Ranked at ${(row.priority_score ?? 0).toFixed?.(1) ?? row.priority_score} but confidence is ${confidence}`,
    `Unresolved: ${missing.map((d) => d.key).join(", ")}`,
    `Next cheapest answer: ${cheapestNext.key} (${cheapestNext.cost}) — ${cheapestNext.note}`,
  ];

  return { debt, missing: missing.map((d) => d.key), rankUrgency, confidenceGap, cheapestNext, reasons };
}

/** Order a set of candidate rows by who most needs validating next. */
export function orderByEvidenceDebt(rows, opts = {}) {
  return rows
    .map((row) => ({ row, ...calculateEvidenceDebt(row, opts) }))
    .sort((a, b) => b.debt - a.debt || (b.row.priority_score ?? 0) - (a.row.priority_score ?? 0));
}

// ---------------------------------------------------------------------------
// Promotion gating. Tunable without a redeploy — these are read at request
// time, not module load, so changing a Vercel env var takes effect on the next
// invocation rather than the next build.
// ---------------------------------------------------------------------------
export function gateConfig() {
  const num = (v, d) => (v != null && v !== "" && isFinite(Number(v)) ? Number(v) : d);
  return {
    enabled: (process.env.EVIDENCE_DEBT_ENABLED ?? "true") !== "false",
    confidenceFloor: num(process.env.PROMOTE_CONFIDENCE_FLOOR, 60),
    minScore: num(process.env.PROMOTE_MIN_SCORE, 75),
    residentialOnly: (process.env.PROMOTE_RESIDENTIAL_ONLY ?? "true") !== "false",
    maxAssessedValue: num(process.env.PROMOTE_MAX_ASSESSED_VALUE, null),
    // Consecutive qualifying rescore cycles before a lead is shown to a human.
    // Stops the review queue thrashing every time one evidence call lands.
    stabilityCycles: num(process.env.PROMOTE_STABILITY_CYCLES, 2),
    // Dimensions that must be RESOLVED (not merely attempted) before review.
    requiredEvidence: (process.env.PROMOTE_REQUIRED_EVIDENCE ?? "storm")
      .split(",").map((s) => s.trim()).filter(Boolean),
  };
}

/**
 * Is this lead allowed in front of a human yet?
 *
 * Returns { eligible, blockers } — blockers is always populated on failure so
 * the UI can say "3 leads withheld: awaiting permit evidence" instead of
 * silently showing an empty list and looking broken.
 */
export function evaluatePromotion(row, cfg = gateConfig()) {
  const blockers = [];

  if (!cfg.enabled) return { eligible: true, blockers: [] };

  if ((row.priority_score ?? 0) < cfg.minScore) {
    blockers.push(`score ${row.priority_score ?? 0} < ${cfg.minScore}`);
  }
  if ((row.confidence_score ?? 0) < cfg.confidenceFloor) {
    blockers.push(`confidence ${row.confidence_score ?? 0} < floor ${cfg.confidenceFloor}`);
  }
  if (cfg.residentialOnly && row.property_class !== "likely_residential") {
    blockers.push(`property_class=${row.property_class ?? "null"} (residential only)`);
  }
  if (cfg.maxAssessedValue != null && (row.assessed_value ?? 0) > cfg.maxAssessedValue) {
    blockers.push(`assessed_value ${row.assessed_value} > ceiling ${cfg.maxAssessedValue}`);
  }
  if (row.review_status === "rejected") {
    blockers.push("previously rejected by a human");
  }
  for (const key of cfg.requiredEvidence) {
    const dim = EVIDENCE_DIMENSIONS.find((d) => d.key === key);
    if (dim && !isResolved(row[dim.column])) {
      blockers.push(`${key} evidence unresolved (${row[dim.column] ?? "unknown"})`);
    }
  }
  if ((row.promotion_streak ?? 0) < cfg.stabilityCycles) {
    blockers.push(`held ${row.promotion_streak ?? 0}/${cfg.stabilityCycles} stable cycles`);
  }

  return { eligible: blockers.length === 0, blockers };
}

/** Aggregate blockers across a candidate set — "what is the system waiting on." */
export function summarizeBlockers(rows, cfg = gateConfig()) {
  const counts = {};
  for (const row of rows) {
    for (const b of evaluatePromotion(row, cfg).blockers) {
      const bucket = b.split(" ")[0];
      counts[bucket] = (counts[bucket] ?? 0) + 1;
    }
  }
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([blocker, count]) => ({ blocker, count }));
}
