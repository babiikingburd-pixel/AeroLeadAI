// lib/evidenceIndex/constants.js — every tunable threshold in one place.
// Ported from evidence_index/ Python prototype's constants.py, unchanged.
// When real outcome data (closed deals) exists, these are the first
// numbers to revisit — most start as reasonable, documented defaults
// rather than fitted values, because there's no closed-deal history yet
// to fit them to.

// --- maturity (roof age) ---
export const MATURITY_TIERS = [
  // [minAge, level, points]
  [25, 3, 60],
  [20, 2, 50],
  [15, 1, 40],
];
export const PERMIT_RECENCY_YEARS = 10; // a permit within this window zeroes out maturity evidence

// --- evidence engine: storm thresholds ---
export const HAIL_INCHES_THRESHOLD = 1.75;
export const HAIL_POINTS = 14;
export const WIND_MPH_THRESHOLD = 70;
export const WIND_POINTS = 12;
export const SNOW_POINTS = 7;
export const RAIN_POINTS = 5;

// --- evidence engine: ancillary service flags ---
// Initial point values, same order of magnitude as the storm flags above.
// Starting weights, not fitted ones — revisit once tree/gutter/driveway
// jobs have enough closed-deal volume to compute real effect sizes.
export const TREE_RISK_POINTS = 10;
export const GUTTER_DAMAGE_POINTS = 6;
export const DRIVEWAY_CRACK_POINTS = 5;

// --- confidence engine ---
export const HUMAN_REVIEW_CONFIDENCE_BOOST = 20; // a human-confirmed lead gets a flat confidence bump, capped at 100

// --- opportunity engine ---
export const PROPERTY_VALUE_WEIGHT = 0.4;
export const ROOF_ESTIMATE_WEIGHT = 0.3;
export const ANCILLARY_SERVICE_WEIGHT = 0.5; // ancillary job estimates count at half weight vs. the primary roof estimate

// The original spec's opportunity formula produces raw dollar figures (a
// $320k home alone scores ~133,400), but the human-review threshold
// expects a 0-100-ish scale (opportunity >= 75) — those two were
// inconsistent with each other. OPPORTUNITY_NORMALIZATION_DIVISOR converts
// the raw dollar score to a 0-100 scale for review-threshold comparisons;
// the raw dollar figure is still returned separately for real display use.
// Chosen so a ~$150k raw opportunity score (a strong, typical lead) lands
// around 75 on the normalized scale — revisit once real deal volume shows
// what opportunity level actually predicts conversion.
export const OPPORTUNITY_NORMALIZATION_DIVISOR = 2000;

// --- human review ---
export const EVIDENCE_REVIEW_THRESHOLD = 80;
export const CONFIDENCE_REVIEW_THRESHOLD = 60; // review triggers when confidence is AT OR BELOW this
export const OPPORTUNITY_REVIEW_THRESHOLD = 75;
