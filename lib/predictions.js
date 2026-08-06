// Items #5 + #9: predictive scores, with a confidence engine attached.
//
// Honest label up front: this is `heuristic-v1` — rule-based scoring off
// the timeline/changes/graph data you actually have, NOT a trained model.
// There's no outcome dataset yet to train a real classifier against (that's
// exactly what lib/outcomes.js starts collecting). Once lead_outcomes has
// a few hundred rows with real stage progressions, replace the scoring
// functions below with a model trained on that — the reasons/weights here
// are what you'd start from for feature engineering, not throw away.
//
// Every prediction ships with a `reasons` array: { reason, weight, confidence }.
// That's the point — a bare "84%" is a black box, "84%, because: permit
// spike + assessment increase + ownership age" is something a rep can act on.

import { supabaseGet, supabasePost } from "./supabaseRest";
import { getTimeline } from "./timeline";
import { getRecentChanges } from "./changeDetector";
import { getProperty } from "./properties";

function monthsSince(dateStr) {
  if (!dateStr) return null;
  const then = new Date(dateStr);
  if (isNaN(then)) return null;
  return (Date.now() - then.getTime()) / (1000 * 60 * 60 * 24 * 30.44);
}

function clamp01(n) { return Math.max(0, Math.min(1, n)); }

export async function computePredictions(propertyId) {
  const [propRes, timelineRes, changesRes] = await Promise.all([
    getProperty(propertyId),
    getTimeline(propertyId, 200),
    getRecentChanges(propertyId, 50),
  ]);
  if (!propRes.ok || !propRes.property) return { ok: false, error: propRes.error || "property not found" };

  const property = propRes.property;
  const timeline = timelineRes.ok ? timelineRes.data : [];
  const changes = changesRes.ok ? changesRes.data : [];

  const reasons = []; // { field, reason, weight, confidence }
  const add = (field, reason, weight, confidence) => reasons.push({ field, reason, weight, confidence });

  const permitEvents12mo = timeline.filter((e) => e.event_type === "permit" && monthsSince(e.event_date) <= 12);
  const violationEvents = timeline.filter((e) => e.event_type === "code_violation");
  const listingEvents = timeline.filter((e) => e.event_type === "listing");
  const ownershipEvents = timeline.filter((e) => e.event_type === "ownership_transfer");
  const assessmentEvents = timeline.filter((e) => e.event_type === "assessment_change");
  const monthsSinceSale = monthsSince(property.last_sale_date);
  const monthsSinceLastOwnershipEvent = ownershipEvents.length ? monthsSince(ownershipEvents[0].event_date) : monthsSinceSale;

  // --- renovation_probability ---
  let renovation = 0.15; // base rate
  if (permitEvents12mo.length >= 2) { renovation += 0.35; add("renovation_probability", `${permitEvents12mo.length} permits pulled in the last 12 months`, 0.35, 0.9); }
  else if (permitEvents12mo.length === 1) { renovation += 0.15; add("renovation_probability", "one permit pulled in the last 12 months", 0.15, 0.75); }
  if (assessmentEvents.length) { renovation += 0.15; add("renovation_probability", "assessed value increased recently", 0.15, 0.7); }
  if (monthsSinceLastOwnershipEvent != null && monthsSinceLastOwnershipEvent > 60) { renovation += 0.1; add("renovation_probability", "owned 5+ years — due for deferred maintenance", 0.1, 0.55); }
  renovation = clamp01(renovation);

  // --- investor_likelihood ---
  let investor = 0.1;
  if (property.owner_entity_type === "llc" || /\bllc\b/i.test(property.owner_name || "")) { investor += 0.55; add("investor_likelihood", "owner is an LLC entity", 0.55, 0.9); }
  if (property.owner_entity_type === "trust") { investor += 0.2; add("investor_likelihood", "owner is a trust", 0.2, 0.6); }
  investor = clamp01(investor);

  // --- sale_probability ---
  let sale = 0.1;
  if (listingEvents.length) { sale += 0.5; add("sale_probability", "active or recent listing on record", 0.5, 0.95); }
  if (monthsSinceSale != null && monthsSinceSale > 84) { sale += 0.15; add("sale_probability", "7+ years since last recorded sale", 0.15, 0.5); }
  if (violationEvents.length >= 2) { sale += 0.1; add("sale_probability", "multiple code violations may push a sale", 0.1, 0.4); }
  sale = clamp01(sale);

  // --- distress_probability ---
  let distress = 0.05;
  if (violationEvents.length === 1) { distress += 0.2; add("distress_probability", "one open code violation", 0.2, 0.7); }
  if (violationEvents.length >= 2) { distress += 0.4; add("distress_probability", `${violationEvents.length} code violations on record`, 0.4, 0.85); }
  const negativeChanges = changes.filter((c) => c.change_type === "tax_change" && c.magnitude < 0);
  if (negativeChanges.length) { distress += 0.15; add("distress_probability", "tax/assessment decline recorded", 0.15, 0.6); }
  distress = clamp01(distress);

  // --- appreciation_potential ---
  let appreciation = 0.3;
  let neighborhoodStats = null;
  if (property.neighborhood_id) {
    const nRes = await supabaseGet(`neighborhood_stats?neighborhood_id=eq.${property.neighborhood_id}&select=*&limit=1`);
    neighborhoodStats = nRes.ok ? nRes.data?.[0] : null;
  }
  if (neighborhoodStats?.growth_score != null) {
    const g = clamp01(neighborhoodStats.growth_score / 100);
    appreciation = clamp01(appreciation * 0.4 + g * 0.6);
    add("appreciation_potential", `neighborhood growth score ${neighborhoodStats.growth_score}/100`, 0.6, 0.65);
  } else {
    add("appreciation_potential", "no neighborhood stats on file yet — base rate only", 0, 0.2);
  }
  appreciation = clamp01(appreciation);

  // --- commercial_conversion_potential ---
  let commercial = 0.05;
  const zoning = (property.zoning || "").toLowerCase();
  if (zoning.includes("mixed") || zoning.includes("commercial")) { commercial += 0.5; add("commercial_conversion_potential", `zoning is "${property.zoning}"`, 0.5, 0.8); }
  else if (zoning.includes("residential")) { add("commercial_conversion_potential", "zoned residential — low conversion likelihood absent a rezoning", 0, 0.7); }
  if (neighborhoodStats?.commercial_expansion_score != null) {
    const c = clamp01(neighborhoodStats.commercial_expansion_score / 100);
    commercial = clamp01(commercial * 0.6 + c * 0.4);
    add("commercial_conversion_potential", `neighborhood commercial expansion score ${neighborhoodStats.commercial_expansion_score}/100`, 0.4, 0.5);
  }
  commercial = clamp01(commercial);

  const predictions = {
    property_id: propertyId,
    renovation_probability: renovation,
    investor_likelihood: investor,
    sale_probability: sale,
    distress_probability: distress,
    appreciation_potential: appreciation,
    commercial_conversion_potential: commercial,
    model_version: "heuristic-v1",
    computed_at: new Date().toISOString(),
  };

  const upsert = await supabasePost("property_predictions", [predictions], { headers: { Prefer: "return=representation,resolution=merge-duplicates" } });
  if (!upsert.ok) return upsert;

  // Reasons: delete-then-insert is simplest given no per-field unique key;
  // fine at this volume, revisit if reason history needs to be preserved.
  await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "")}/rest/v1/property_prediction_reasons?property_id=eq.${propertyId}`, {
    method: "DELETE",
    headers: {
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY}`,
    },
  }).catch(() => {});

  if (reasons.length) {
    await supabasePost("property_prediction_reasons", reasons.map((r) => ({
      property_id: propertyId, prediction_field: r.field, reason: r.reason,
      weight: r.weight, confidence: r.confidence,
    })));
  }

  return { ok: true, predictions, reasons };
}

export async function getPredictions(propertyId) {
  const [pred, reasons] = await Promise.all([
    supabaseGet(`property_predictions?property_id=eq.${propertyId}&select=*&limit=1`),
    supabaseGet(`property_prediction_reasons?property_id=eq.${propertyId}&select=*&order=weight.desc`),
  ]);
  return {
    ok: pred.ok,
    predictions: pred.ok ? pred.data?.[0] || null : null,
    reasons: reasons.ok ? reasons.data : [],
  };
}
