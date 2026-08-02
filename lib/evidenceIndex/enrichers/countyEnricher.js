// lib/evidenceIndex/enrichers/countyEnricher.js
//
// Looks up which of the six supported counties a lead belongs to and
// attaches its multiplier. Matching logic is real (normalizes and checks
// against the supported list); the multiplier VALUES themselves are
// neutral placeholders (see config.js's docstring) until real closed-deal
// data exists to learn them from. Ported from evidence_index/ Python
// prototype's enrichers/county_enricher.py, unchanged.

import { SUPPORTED_COUNTIES, COUNTY_MULTIPLIERS } from "../config";

export function normalizeCounty(name) {
  return (name || "").trim().toLowerCase().replace(" county", "");
}

/**
 * Expects lead.county (or leaves it unenriched if missing/unsupported —
 * never guesses a county for an address). Returns the lead with
 * countyNormalized / countyMultiplier / countySupported added.
 */
export function enrichCounty(lead) {
  const normalized = normalizeCounty(lead.county);

  if (!SUPPORTED_COUNTIES.includes(normalized)) {
    return { ...lead, countyNormalized: normalized || null, countyMultiplier: 1.0, countySupported: false };
  }

  return { ...lead, countyNormalized: normalized, countyMultiplier: COUNTY_MULTIPLIERS[normalized], countySupported: true };
}
