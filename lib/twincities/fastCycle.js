import { calculatePriority } from "./priorityEngine";

export const TC_COUNTIES = ["hennepin", "ramsey", "dakota", "scott", "carver", "anoka"];

export const FAST_SCORE_FIELDS = [
  "id","address","city","county","state","zip","lat","lon","year_built","permit_within_10y",
  "permit_notes","permit_evidence_status","permit_checked_at","hail_inches","wind_mph","storm_date",
  "storm_evidence_status","storm_checked_at","weather_evidence_status","weather_checked_at",
  "assessed_value","value_evidence_status","assessor_checked_at","value_checked_at","replacement_cost",
  "review_status","sales_status","property_class","property_use_type","residential_status","residential_confidence","tree_score","driveway_score","damage_notes",
  "image_evidence_status","image_fetched_at","image_review_status","image_review_confidence","roof_visual_score","priority_score","confidence_score",
  "evidence_score","scored_at","validation_status","validation_score","validation_confidence",
  "validation_priority","last_validated_at","next_validation_at","evidence_cycle_at","development_signal","updated_at"
].join(",");

export function scoreRow(row) {
  const permitChecked = ["verified","none_found"].includes(row.permit_evidence_status) || !!row.permit_checked_at || !!row.permit_notes;
  const stormChecked = ["verified","none_found","checked"].includes(row.storm_evidence_status) || row.weather_evidence_status === "verified" || !!row.storm_checked_at || !!row.weather_checked_at || !!row.storm_date;
  const assessorChecked = row.assessed_value != null && Number(row.assessed_value) > 0;
  const imageryChecked = ["verified","fetched","ready","reviewed"].includes(String(row.image_evidence_status || "").toLowerCase()) || !!row.image_fetched_at || row.image_review_status === "approved";

  const priorityInput = {
    county: row.county,
    yearBuilt: row.year_built,
    permit_within_10y: row.permit_within_10y,
    permitChecked,
    stormChecked,
    assessorChecked,
    imageryChecked,
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
  return {
    ...row,
    ...scored,
    sourceStatus: { permit: permitChecked, storm: stormChecked, assessor: assessorChecked, imagery: imageryChecked },
  };
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
  if (!["verified","none_found"].includes(row.permit_evidence_status)) checks.push("permit");
  if (!(row.weather_evidence_status === "verified" || row.storm_evidence_status === "verified" || row.storm_checked_at || row.weather_checked_at)) checks.push("storm");
  if (!["verified","fetched","ready","reviewed"].includes(String(row.image_evidence_status || "").toLowerCase())) checks.push("imagery");
  return [...new Set(checks)];
}
