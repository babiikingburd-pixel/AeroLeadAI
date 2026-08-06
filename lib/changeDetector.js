// Item #4: change detection. The premise from the plan is right — static
// data is worth little, deltas are worth a lot — so every change gets a
// point value and a rolling 90-day sum becomes change_score (0-100).
//
// Point values below are a starting heuristic, not a trained model. Tune
// them once you have outcome data (lead_outcomes) to check them against —
// e.g. if 'ownership_transfer' correlates with contract_signed way more
// than its current weight implies, raise it.

import { supabaseGet, supabasePost } from "./supabaseRest";
import { updatePropertyScore } from "./properties";

const CHANGE_POINTS = {
  new_permit: 15,
  utility_permit: 8,
  tax_change: 10,
  listing_change: 20,
  ownership_transfer: 25,
  zoning_update: 18,
  imagery_diff: 12,
  new_construction: 22,
};

export async function recordChange({ propertyId, changeType, magnitude, detail, source = "manual" }) {
  if (!propertyId || !changeType) return { ok: false, error: "propertyId and changeType required" };
  const points = CHANGE_POINTS[changeType] ?? 5;

  const insert = await supabasePost("property_changes", [{
    property_id: propertyId, change_type: changeType, magnitude: magnitude ?? null,
    detail: detail ?? null, change_score_contribution: points, source,
  }]);
  if (!insert.ok) return insert;

  const rollup = await recomputeChangeScore(propertyId);
  return { ok: true, change: insert.data?.[0], change_score: rollup.change_score };
}

// Reads the property_change_scores view (defined in the schema file) and
// writes the result back onto properties.property_score so the console can
// sort/filter on a plain column instead of joining a view every time.
export async function recomputeChangeScore(propertyId) {
  const res = await supabaseGet(`property_change_scores?property_id=eq.${propertyId}&select=*&limit=1`);
  const change_score = res.ok && res.data?.length ? res.data[0].change_score : 0;
  await updatePropertyScore(propertyId, change_score);
  return { change_score };
}

export async function getRecentChanges(propertyId, limit = 25) {
  return supabaseGet(`property_changes?property_id=eq.${propertyId}&select=*&order=detected_at.desc&limit=${limit}`);
}

// Highest-change_score properties across the whole book — this is the
// "opportunity feed" the plan describes: high scores mean opportunity.
export async function getTopOpportunities(limit = 25) {
  return supabaseGet(`properties?select=*&order=property_score.desc.nullslast&limit=${limit}`);
}
