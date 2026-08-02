// lib/evidenceIndex/engines/evidenceEngine.js
//
// evidenceScore = maturity + hail + wind + snow + rain + tree + gutter + driveway
//
// Ported from evidence_index/ Python prototype's engines/evidence_engine.py,
// unchanged. Nothing here is randomized or guessed at runtime — every
// point value traces back to a named constant in constants.js.

import {
  MATURITY_TIERS,
  HAIL_INCHES_THRESHOLD,
  HAIL_POINTS,
  WIND_MPH_THRESHOLD,
  WIND_POINTS,
  SNOW_POINTS,
  RAIN_POINTS,
  TREE_RISK_POINTS,
  GUTTER_DAMAGE_POINTS,
  DRIVEWAY_CRACK_POINTS,
} from "../constants";

/**
 * Returns [level, points]. A recent permit zeroes out roof-age evidence
 * entirely — a roof with a permit in the last PERMIT_RECENCY_YEARS was
 * already addressed, regardless of its calendar age.
 */
export function maturityLevel(age, permitWithin10y) {
  if (permitWithin10y) return [0, 0];
  for (const [minAge, level, points] of MATURITY_TIERS) {
    if (age >= minAge) return [level, points];
  }
  return [0, 0];
}

export function evidenceScore(lead) {
  let score = 0;

  const [, maturityPoints] = maturityLevel(lead.age ?? 0, lead.permitWithin10y ?? false);
  score += maturityPoints;

  if ((lead.hailInches ?? 0) >= HAIL_INCHES_THRESHOLD) score += HAIL_POINTS;
  if ((lead.windMph ?? 0) >= WIND_MPH_THRESHOLD) score += WIND_POINTS;
  if (lead.heavySnow) score += SNOW_POINTS;
  if (lead.heavyRain) score += RAIN_POINTS;

  // Ancillary service flags — each is independent of roof evidence and
  // additive, since a property can have tree risk AND roof damage AND
  // gutter damage simultaneously.
  if (lead.treeRisk) score += TREE_RISK_POINTS;
  if (lead.gutterDamage) score += GUTTER_DAMAGE_POINTS;
  if (lead.drivewayCracks) score += DRIVEWAY_CRACK_POINTS;

  return score;
}
