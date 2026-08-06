import { calculatePriority } from "./priorityEngine";

export const TC_COUNTIES = ["hennepin", "ramsey", "dakota", "scott", "carver", "anoka"];

export const FAST_SCORE_FIELDS = [
  "id","address","city","county","lat","lon","year_built","permit_within_10y",
  "permit_notes","permit_evidence_status","hail_inches","wind_mph","storm_date",
  "assessed_value","replacement_cost","review_status","sales_status","property_class",
  "tree_score","driveway_score","damage_notes","priority_score","confidence_score",
  "evidence_score","scored_at","validation_status","validation_score","validation_confidence",
  "validation_priority","last_validated_at","next_validation_at"
].join(",");

export function scoreRow(row) {
  const priorityInput = {
    county: row.county,
    yearBuilt: row.year_built,
    permit_within_10y: row.permit_within_10y,
    permitChecked: row.permit_evidence_status === "verified" || row.permit_evidence_status === "none_found" || !!row.permit_notes,
    hailInches: row.hail_inches,
    windMph: row.wind_mph,
    assessedValue: row.assessed_value,
    reviewStatus: row.review_status,
    roofEstimateUsd: row.replacement_cost ?? null,
    heavySnowRegion: row.damage_notes?.heavySnowRegion === true,
    heavyRainRegion: row.damage_notes?.heavyRainRegion === true,
    treeOverhang: row.damage_notes?.treeOverhang === true || (row.tree_score ?? 0) >= 50,
    largeOverhang: row.damage_notes?.largeOverhang === true || (row.tree_score ?? 0) >= 80,
    drivewayCrackRisk: (row.driveway_score ?? 0) >= 50,
    gutterIndicator: row.damage_notes?.gutterIndicator === true,
  };
  const scored = calculatePriority(priorityInput);
  return { ...row, ...scored };
}

export function validationPriority(row) {
  const score = Number(row.priorityScore ?? row.priority_score ?? 0);
  const confidence = Number(row.confidenceScore ?? row.confidence_score ?? 0);
  const evidenceGap = Math.max(0, 100 - confidence);
  const staleDays = row.last_validated_at ? Math.max(0, (Date.now() - Date.parse(row.last_validated_at)) / 86400000) : 30;
  const freshness = Math.min(100, staleDays * 8);
  const unresolved = row.validation_status !== "validated" ? 20 : 0;
  return Math.round((score * 0.50 + evidenceGap * 0.25 + freshness * 0.15 + unresolved * 0.10) * 100) / 100;
}

export function buildValidationChecks(row) {
  const checks = [];
  if (!row.parcel_id || !row.assessed_value || !row.year_built) checks.push("assessor");
  if (row.permit_evidence_status !== "verified" && row.permit_evidence_status !== "none_found") checks.push("permit");
  if (row.hail_inches == null && row.wind_mph == null) checks.push("storm");
  // image_evidence_status is retrieval state only (fetched / failed) as of
  // APEX 9.7 — see the column comment in the evidence-gate migration. It never
  // holds "verified", so testing it that way queued an imagery check for every
  // lead forever, including ones already fetched and reviewed.
  // image_review_status is the column that actually terminates.
  if (!["verified", "adjudicated"].includes(row.image_review_status)) checks.push("imagery");
  return [...new Set(checks)];
}
