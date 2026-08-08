// Item #8: outcome tracking. This is what eventually lets predictions.js
// graduate from heuristic-v1 to an actual trained model — you can't train
// on money until you're recording money.

import { supabaseGet, supabasePost } from "./supabaseRest";

const STAGES = ["lead_generated", "contacted", "meeting_booked", "contract_signed", "revenue_created", "dead"];

export async function logOutcome({ propertyId, stage, stageValue, notes }) {
  if (!STAGES.includes(stage)) return { ok: false, error: `stage must be one of: ${STAGES.join(", ")}` };
  return supabasePost("lead_outcomes", [{
    property_id: propertyId ?? null, stage, stage_value: stageValue ?? null, notes: notes ?? null,
  }]);
}

export async function getOutcomes(propertyId) {
  return supabaseGet(`lead_outcomes?property_id=eq.${propertyId}&select=*&order=occurred_at.desc`);
}

// Simple funnel rollup — counts per stage plus total revenue, across
// everything or filtered to a date range you fetch with an outer query.
// Kept intentionally simple; this is the raw material for a real
// conversion-rate model, not the model itself.
export async function getFunnelSummary() {
  const res = await supabaseGet(`lead_outcomes?select=stage,stage_value`);
  if (!res.ok) return res;
  const summary = {};
  let totalRevenue = 0;
  for (const row of res.data) {
    summary[row.stage] = (summary[row.stage] || 0) + 1;
    if (row.stage === "revenue_created" && row.stage_value) totalRevenue += Number(row.stage_value);
  }
  return { ok: true, summary, totalRevenue };
}
