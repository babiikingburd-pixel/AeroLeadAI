export const COUNTY_MULTIPLIERS = {
  hennepin: 1.30,
  scott: 1.25,
  carver: 1.20,
  dakota: 1.15,
  ramsey: 1.10,
  anoka: 1.05,
};

const CURRENT_YEAR = new Date().getFullYear();

export function checkEntry(lead) {
  const age = lead.yearBuilt ? CURRENT_YEAR - lead.yearBuilt : null;
  const hasPermit = !!lead.permit_within_10y;
  if (age !== null && age >= 15 && !hasPermit) {
    if (age >= 25) return { entered: true, route: "maturity", basePoints: 60, level: 3 };
    if (age >= 20) return { entered: true, route: "maturity", basePoints: 50, level: 2 };
    return { entered: true, route: "maturity", basePoints: 40, level: 1 };
  }
  const stormQualifies = (lead.hailInches ?? 0) >= 1.0 || (lead.windMph ?? 0) >= 70 || lead.largeFallenTree === true || lead.majorStructuralEvent === true;
  if (stormQualifies) return { entered: true, route: "storm", basePoints: 0, level: null };
  return { entered: false, route: null, basePoints: 0, level: null };
}

export function scoreEvidence(lead) {
  const entry = checkEntry(lead);
  const breakdown = {};
  if (!entry.entered) return { entered: false, score: 0, categories: [], route: null, breakdown };
  let score = entry.basePoints;
  const categories = [];
  if (entry.basePoints > 0) breakdown.maturity = entry.basePoints;
  const add = (points, category, key, condition) => { if (condition) { score += points; categories.push(category); breakdown[key] = points; } };
  add(7, "heavy_snow_region", "heavy_snow", lead.heavySnowRegion === true);
  add(5, "heavy_rain_region", "heavy_rain", lead.heavyRainRegion === true);
  add(7, "tree_overhang", "tree_overhang", lead.treeOverhang === true);
  add(14, "large_overhang", "large_overhang", lead.largeOverhang === true);
  add(10, "hail_1in", "hail", (lead.hailInches ?? 0) >= 1.0 && (lead.hailInches ?? 0) < 1.75);
  add(14, "hail_golfball", "hail", (lead.hailInches ?? 0) >= 1.75);
  add(12, "wind_70mph", "wind", (lead.windMph ?? 0) >= 70);
  add(5, "driveway_cracking", "driveway", lead.drivewayCrackRisk === true);
  add(7, "gutter_indicator", "gutter", lead.gutterIndicator === true);
  return { entered: true, score, categories, route: entry.route, level: entry.level, breakdown };
}

export function scoreConfidence(lead, evidenceResult) {
  if (!evidenceResult.entered) return 0;
  // Four independent machine-verifiable lanes. Do not infer imagery from a default false tree flag.
  const checks = [
    lead.permitChecked === true,
    lead.stormChecked === true,
    lead.assessorChecked === true || (lead.assessedValue != null && lead.assessedValue > 0),
    lead.imageryChecked === true,
  ];
  let points = Math.round((checks.filter(Boolean).length / checks.length) * 70);
  if (lead.reviewStatus === "approved") points += 30;
  else if (lead.reviewStatus === "partial") points += 15;
  else if (lead.reviewStatus === "rejected") points = Math.min(points, 20);
  return Math.min(points, 100);
}

export function needsHumanReview({ evidence, categories, assessedValue, route, level }) {
  return evidence >= 80 || categories.length >= 3 || ((assessedValue ?? 0) > 500000 && evidence > 70) || (route === "storm" && level !== null);
}

export function classifyTier(confidenceScore) {
  if (confidenceScore >= 70) return "A";
  if (confidenceScore >= 35) return "B";
  return "investigate";
}

const REASON_LABELS = { maturity:"Property age", heavy_snow:"Heavy snow region", heavy_rain:"Heavy rain region", tree_overhang:"Tree overhang", large_overhang:"Large tree overhang", hail:"Hail exposure", wind:"Wind exposure", driveway:"Driveway cracking risk", gutter:"Gutter indicator" };

function buildReasons(breakdown, propertyFactor, jobEstimate, valueWeight = 0.35) {
  const reasons = [];
  for (const [key, label] of Object.entries(REASON_LABELS)) if (breakdown[key] != null && breakdown[key] !== 0) reasons.push({ signal:key, label, contribution:breakdown[key] });
  if (propertyFactor > 0) reasons.push({ signal:"property_value", label:"Assessed property value", contribution:Math.round(propertyFactor * 100 * valueWeight * 100) / 100 });
  if (jobEstimate > 0) reasons.push({ signal:"job_estimate", label:"Estimated job value", contribution:Math.round(jobEstimate * 0.0001 * 0.20 * 100) / 100 });
  if (breakdown.county_multiplier != null && breakdown.county_multiplier !== 1.0) reasons.push({ signal:"county_multiplier", label:"County multiplier", contribution:`×${breakdown.county_multiplier}` });
  return reasons.sort((a,b)=>(typeof b.contribution === "number" ? b.contribution : 0) - (typeof a.contribution === "number" ? a.contribution : 0));
}

export function calculatePriority(lead) {
  const { entered, score:evidenceScore, categories, route, level, breakdown } = scoreEvidence(lead);
  if (!entered) return { priorityScore:0, evidenceScore:0, confidenceScore:0, categories:[], breakdown:{}, humanReview:false, entered:false };
  const humanReview = needsHumanReview({ evidence:evidenceScore, categories, assessedValue:lead.assessedValue, route, level });
  const confidenceScore = scoreConfidence(lead, { entered });
  if (lead.reviewStatus === "rejected") return { priorityScore:0, evidenceScore, confidenceScore, categories, breakdown, humanReview, entered:true, route, suppressed:"rejected" };
  const valueCap = Number(process.env.PRIORITY_VALUE_FACTOR_CAP ?? 2.0);
  const valueWeight = Number(process.env.PRIORITY_VALUE_WEIGHT ?? 0.35);
  const propertyFactor = Math.min((lead.assessedValue ?? 0) / 1_000_000, valueCap);
  const jobEstimate = (lead.roofEstimateUsd ?? 0) + (lead.treeEstimateUsd ?? 0) + (lead.gutterEstimateUsd ?? 0) + (lead.drivewayEstimateUsd ?? 0);
  const raw = evidenceScore * 0.45 + propertyFactor * 100 * valueWeight + jobEstimate * 0.0001 * 0.20;
  const multiplier = COUNTY_MULTIPLIERS[(lead.county || "").toLowerCase()] ?? 1.0;
  const priorityScore = Math.round(raw * multiplier * 100) / 100;
  breakdown.county_multiplier = multiplier;
  breakdown.final = priorityScore;
  const reasons = buildReasons(breakdown, propertyFactor, jobEstimate, valueWeight);
  return { priorityScore, evidenceScore, confidenceScore, categories, breakdown, reasons, humanReview, entered:true, route, tier:classifyTier(confidenceScore) };
}
