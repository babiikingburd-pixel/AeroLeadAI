// lib/twincities/calculateReplacementCost.js
//
// Simple regional-average model, matching your proposed formula. Real
// per-county pricing varies with labor cost and material availability;
// these are broad Twin Cities metro averages (asphalt shingle, 2026), not
// county-specific quotes. Good enough for lead prioritization ranking —
// not good enough for a homeowner-facing estimate without a disclaimer.

const ROOF_MULTIPLIER = 1.15; // roof footprint runs larger than home sqft footprint (overhangs, pitch)

// $/sqft by county — placeholder metro-average figures, not sourced from a
// real cost database. Flagging this explicitly rather than presenting them
// as verified: these need a real source (RSMeans, local contractor
// quotes, or a materials-cost API) before this number should reach a
// homeowner or contractor-facing estimate.
const REGIONAL_COST_PER_SQFT = {
  hennepin: 5.75,
  ramsey: 5.5,
  dakota: 5.25,
  scott: 5.0,
  carver: 5.0,
  anoka: 5.0,
  washington: 5.25,
  default: 5.25,
};

/**
 * @param {{squareFeet: number, county: string}} input
 * @returns {number|null}
 */
export function calculateReplacementCost({ squareFeet, county }) {
  if (!squareFeet || squareFeet <= 0) return null;
  const costPerSqft = REGIONAL_COST_PER_SQFT[(county || "").toLowerCase()] ?? REGIONAL_COST_PER_SQFT.default;
  return Math.round(squareFeet * ROOF_MULTIPLIER * costPerSqft);
}
