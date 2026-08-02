// lib/evidenceIndex/engines/opportunityEngine.js
//
// opportunity = propertyValue + roofEstimate + countyMultiplier + ancillaryServices
//
// Ported from evidence_index/ Python prototype's engines/opportunity_engine.py,
// with its two deliberate deviations preserved (both were flagged there
// rather than done silently, and stay flagged here):
//
// 1. countyMultiplier is applied MULTIPLICATIVELY to the base estimate,
//    not added as a raw line item. A "multiplier" that's literally summed
//    alongside dollar amounts doesn't behave like a multiplier (a
//    countyMultiplier of 1.0 would add a flat $1 to every property
//    regardless of size). See enrichers/countyEnricher.js for where the
//    multiplier comes from (currently neutral 1.0 for all six counties,
//    pending real outcome data).
//
// 2. This function returns BOTH the raw dollar opportunity AND a
//    normalized 0-100 score. The original spec's dollar formula and its
//    review threshold were inconsistent with each other — a real $320k
//    home alone scores ~133,400 in the raw dollar formula, so a >=75
//    threshold would trigger review on every single real property,
//    always. humanReview.js uses the normalized score; the raw dollar
//    figure is preserved for real display/export use.

import { PROPERTY_VALUE_WEIGHT, ROOF_ESTIMATE_WEIGHT, ANCILLARY_SERVICE_WEIGHT, OPPORTUNITY_NORMALIZATION_DIVISOR } from "../constants";

/**
 * @param {object} lead
 * @param {number} countyMultiplier
 * @returns {{rawDollars: number, normalized: number}}
 */
export function opportunityScore(lead, countyMultiplier = 1.0) {
  let base = (lead.propertyValue ?? 0) * PROPERTY_VALUE_WEIGHT + (lead.roofEstimate ?? 0) * ROOF_ESTIMATE_WEIGHT;
  base *= countyMultiplier;

  const ancillaryTotal = Object.values(lead.ancillaryServiceEstimates ?? {}).reduce((a, b) => a + b, 0);
  const rawDollars = base + ancillaryTotal * ANCILLARY_SERVICE_WEIGHT;

  const normalized = Math.min(100, Math.round(rawDollars / OPPORTUNITY_NORMALIZATION_DIVISOR));

  return { rawDollars: Math.round(rawDollars), normalized };
}
