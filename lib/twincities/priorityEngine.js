// lib/twincities/priorityEngine.js
//
// Evidence Index v1.1 + Final Priority Score for the six-county Twin
// Cities strategic plan (Hennepin, Ramsey, Dakota, Scott, Carver, Anoka).
// Pure functions, no I/O — takes an already-enriched lead object (assessed
// value + storm data already attached by propertyValue.js / weather-agent)
// and returns scoring + human-review decisions. Mirrors the pure-function
// style of lib/propertyIntelligence.js in this repo.

export const COUNTY_MULTIPLIERS = {
  hennepin: 1.30,
  scott: 1.25,
  carver: 1.20,
  dakota: 1.15,
  ramsey: 1.10,
  anoka: 1.05,
};

const CURRENT_YEAR = new Date().getFullYear();

/**
 * Route A (maturity) / Route B (storm override) entry check.
 * @returns {{ entered: boolean, route: 'maturity'|'storm'|null, basePoints: number, level: number|null }}
 */
export function checkEntry(lead) {
  const age = lead.yearBuilt ? CURRENT_YEAR - lead.yearBuilt : null;
  const hasPermit = !!lead.permit_within_10y;

  // Route A: maturity entry — 15+ years old, no roof permit on file.
  if (age !== null && age >= 15 && !hasPermit) {
    if (age >= 25) return { entered: true, route: "maturity", basePoints: 60, level: 3 };
    if (age >= 20) return { entered: true, route: "maturity", basePoints: 50, level: 2 };
    return { entered: true, route: "maturity", basePoints: 40, level: 1 }; // 15-20
  }

  // Route B: storm override — property can enter regardless of age if a
  // qualifying storm event hit it.
  const stormQualifies =
    (lead.hailInches ?? 0) >= 1.0 ||
    (lead.windMph ?? 0) >= 70 ||
    lead.largeFallenTree === true ||
    lead.majorStructuralEvent === true;

  if (stormQualifies) {
    return { entered: true, route: "storm", basePoints: 0, level: null }; // storm evidence points accrue separately in v1.1 below
  }

  return { entered: false, route: null, basePoints: 0, level: null };
}

/**
 * Evidence Index v1.1 — additional evidence on top of entry base points.
 * Returns the running total, which categories fired (used by the "3+
 * independent categories" human-review rule), AND a machine-readable
 * breakdown — this is the "why did this house score a 94" answer, meant
 * to be persisted straight into batch_leads.evidence_breakdown so a
 * contractor-facing question never requires re-deriving the math.
 */
export function scoreEvidence(lead) {
  const entry = checkEntry(lead);
  const breakdown = {};
  if (!entry.entered) {
    return { entered: false, score: 0, categories: [], route: null, breakdown };
  }

  let score = entry.basePoints;
  const categories = [];
  if (entry.basePoints > 0) breakdown.maturity = entry.basePoints;

  const add = (points, category, breakdownKey, condition) => {
    if (condition) { score += points; categories.push(category); breakdown[breakdownKey] = points; }
  };

  add(7, "heavy_snow_region", "heavy_snow", lead.heavySnowRegion === true);
  add(5, "heavy_rain_region", "heavy_rain", lead.heavyRainRegion === true);
  add(7, "tree_overhang", "tree_overhang", lead.treeOverhang === true);
  add(14, "large_overhang", "large_overhang", lead.largeOverhang === true);
  add(10, "hail_1in", "hail", (lead.hailInches ?? 0) >= 1.0 && (lead.hailInches ?? 0) < 1.75);
  add(14, "hail_golfball", "hail", (lead.hailInches ?? 0) >= 1.75); // ranges are mutually exclusive (1.0-1.75 vs 1.75+), so only one of these two ever fires per lead
  add(12, "wind_70mph", "wind", (lead.windMph ?? 0) > 70);
  add(5, "driveway_cracking", "driveway", lead.drivewayCrackRisk === true);
  add(7, "gutter_indicator", "gutter", lead.gutterIndicator === true);

  return { entered: true, score, categories, route: entry.route, level: entry.level, breakdown };
}

/**
 * Confidence score — separate from evidence score on purpose (per your
 * correction: don't mix "how much evidence" with "how sure are we the
 * evidence is real"). Based on how many independent data sources actually
 * backed the evidence, not on the evidence total itself. 0-100.
 */
export function scoreConfidence(lead, evidenceResult) {
  if (!evidenceResult.entered) return 0;

  let points = 0;
  const checks = [
    lead.permitChecked === true, // a real lookup happened (permit_notes populated), not just a non-null default
    (lead.hailInches ?? null) !== null || (lead.windMph ?? null) !== null,   // storm data present
    lead.assessedValue != null && lead.assessedValue > 0,                    // county GIS lookup succeeded, not a null/failed enrichment
    (lead.treeOverhang !== undefined || lead.largeOverhang !== undefined),   // tree signal present (from imagery, not defaulted false)
  ];
  const sourcesConfirmed = checks.filter(Boolean).length;
  points = Math.round((sourcesConfirmed / checks.length) * 70); // up to 70 from data completeness

  // Human review adds certainty once a person has actually looked at it —
  // this is why confidence and review status are linked but not equal.
  if (lead.reviewStatus === "approved") points += 30;
  else if (lead.reviewStatus === "partial") points += 15;
  else if (lead.reviewStatus === "rejected") points = Math.min(points, 20); // a rejection caps confidence low regardless of raw evidence

  return Math.min(points, 100);
}

/**
 * Human-review trigger rules — any one condition is sufficient.
 */
export function needsHumanReview({ evidence, categories, assessedValue, route, level }) {
  if (evidence >= 80) return true;
  if (categories.length >= 3) return true;
  if ((assessedValue ?? 0) > 500000 && evidence > 70) return true;
  if (route === "storm" && level !== null) return true; // "storm override + maturity" both true
  return false;
}

/**
 * Tier classification — separate from the priority score itself, this is
 * "how much should you trust this ranking," derived from confidenceScore.
 * Thresholds are scaled to what's actually achievable pre-human-review
 * (confidenceScore currently tops out around 70 without an approved
 * review; the +30 human-review bonus in scoreConfidence pushes it higher
 * once someone has actually looked at the lead) rather than copying
 * arbitrary round numbers that don't correspond to anything reachable yet.
 */
export function classifyTier(confidenceScore) {
  if (confidenceScore >= 50) return "A";
  if (confidenceScore >= 30) return "B";
  return "investigate";
}

/**
 * Final Priority Score = (Evidence x 0.45) + (Property Value factor x 100 x 0.35)
 *                       + (Job Estimate factor x 0.20), then x county multiplier.
 * Job Estimate = roof + tree + gutter + driveway estimate (whatever of
 * those a lead has priced; missing ones just don't contribute).
 *
 * PIPELINE ORDER (corrected per your note — human review sits in the
 * middle, not bolted on after): permit -> storm -> evidence score ->
 * property value -> human-review determination -> THEN priority score.
 * A rejected lead's priority score is suppressed here rather than left
 * for the caller to remember to filter out.
 */
export function calculatePriority(lead) {
  const { entered, score: evidenceScore, categories, route, level, breakdown } = scoreEvidence(lead);
  if (!entered) {
    return { priorityScore: 0, evidenceScore: 0, confidenceScore: 0, categories: [], breakdown: {}, humanReview: false, entered: false };
  }

  const humanReview = needsHumanReview({ evidence: evidenceScore, categories, assessedValue: lead.assessedValue, route, level });
  const confidenceScore = scoreConfidence(lead, { entered });

  // A lead a human has already rejected doesn't get to rank on the
  // priority list, regardless of how the raw formula would score it —
  // that's the actual point of putting review in the middle of the
  // pipeline instead of after.
  if (lead.reviewStatus === "rejected") {
    return { priorityScore: 0, evidenceScore, confidenceScore, categories, breakdown, humanReview, entered: true, route, suppressed: "rejected" };
  }

  const propertyFactor = Math.min((lead.assessedValue ?? 0) / 1_000_000, 2.0);

  const jobEstimate =
    (lead.roofEstimateUsd ?? 0) +
    (lead.treeEstimateUsd ?? 0) +
    (lead.gutterEstimateUsd ?? 0) +
    (lead.drivewayEstimateUsd ?? 0);

  const raw =
    evidenceScore * 0.45 +
    propertyFactor * 100 * 0.35 +
    jobEstimate * 0.0001 * 0.20;

  const multiplier = COUNTY_MULTIPLIERS[(lead.county || "").toLowerCase()] ?? 1.0;
  const priorityScore = Math.round(raw * multiplier * 100) / 100;
  breakdown.county_multiplier = multiplier;
  breakdown.final = priorityScore;

  return { priorityScore, evidenceScore, confidenceScore, categories, breakdown, humanReview, entered: true, route, tier: classifyTier(confidenceScore) };
}
