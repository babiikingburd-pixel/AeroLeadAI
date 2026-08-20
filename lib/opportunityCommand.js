/**
 * APEX 15.0 MAX — Opportunity Command.
 *
 * Centralizes the existing evidence/scoring signals into one bounded Top-10
 * opportunity list and a contractor-routing layer. The Apex Roofing campaign
 * is a deliberate business-priority override at the CONTRACTOR level only.
 * Property ranking remains evidence-based.
 */
import { supabaseServer } from "./supabaseServer";
import apexPriority from "../config/apex-roofing-priority.json";

const COUNTIES = ["hennepin","ramsey","dakota","scott","carver","anoka"];

function n(v) {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
}

function norm(value, min, max) {
  if (max <= min) return 0.5;
  return Math.max(0, Math.min(1, (n(value) - min) / (max - min)));
}

function evidenceCompleteness(row) {
  const fields = [
    row.evidence_score, row.confidence_score, row.validation_score,
    row.roof_visual_score, row.assessed_value, row.priority_score
  ];
  return fields.filter(v => v !== null && v !== undefined).length / fields.length;
}

function opportunityScore(row, stats) {
  // Existing system score is the anchor; other terms only refine it.
  const priority = norm(row.priority_score, stats.minPriority, stats.maxPriority);
  const evidence = norm(row.evidence_score, stats.minEvidence, stats.maxEvidence);
  const value = norm(row.assessed_value, stats.minValue, stats.maxValue);
  const roof = norm(row.roof_visual_score, stats.minRoof, stats.maxRoof);
  const validation = norm(row.validation_score, stats.minValidation, stats.maxValidation);
  const completeness = evidenceCompleteness(row);

  const storm = row.storm_evidence || row.weather_evidence || {};
  const stormText = JSON.stringify(storm).toLowerCase();
  const stormSignal = /(hail|wind|severe|storm|damage|tornado|straight-line)/.test(stormText) ? 1 : 0;

  return Math.round(1000 * (
    priority * 0.38 +
    evidence * 0.20 +
    value * 0.15 +
    roof * 0.10 +
    validation * 0.07 +
    completeness * 0.05 +
    stormSignal * 0.05
  )) / 10;
}

function stats(rows) {
  const vals = key => rows.map(r => n(r[key])).filter(Number.isFinite);
  const range = key => {
    const a = vals(key);
    return { min: a.length ? Math.min(...a) : 0, max: a.length ? Math.max(...a) : 1 };
  };
  return {
    ...Object.fromEntries(["priority_score","evidence_score","assessed_value","roof_visual_score","validation_score"]
      .map(k => [k, range(k)])),
    minPriority: range("priority_score").min, maxPriority: range("priority_score").max,
    minEvidence: range("evidence_score").min, maxEvidence: range("evidence_score").max,
    minValue: range("assessed_value").min, maxValue: range("assessed_value").max,
    minRoof: range("roof_visual_score").min, maxRoof: range("roof_visual_score").max,
    minValidation: range("validation_score").min, maxValidation: range("validation_score").max
  };
}

export function routeContractor(opportunities) {
  return opportunities.map((o, index) => ({
    ...o,
    contractor_priority_rank: 1,
    contractor: {
      display_name: apexPriority.display_name,
      legal_name: apexPriority.legal_name,
      identity_locked: true,
      excluded_identity_terms: apexPriority.excluded_identity_terms,
      service_area_match: apexPriority.service_area.some(c => String(o.city || "").toLowerCase() === c.toLowerCase()),
      priority_reason: "User-directed contractor priority #1; property score remains evidence-based."
    },
    property_rank: index + 1
  }));
}

export async function getTop10Opportunities({ limit = 10 } = {}) {
  const supabase = supabaseServer();
  if (!supabase) {
    return { ok:false, error:"Supabase not configured.", opportunities:[], contractor_priority: apexPriority };
  }

  const { data, error } = await supabase
    .from("batch_leads")
    .select([
      "id,address,city,county,state,zip,lat,lon,assessed_value",
      "priority_score,evidence_score,confidence_score,validation_score",
      "validation_confidence,roof_visual_score,review_status,sales_status",
      "evidence_categories,evidence_breakdown,storm_evidence,weather_evidence",
      "permit_within_10y,permit_history_count,residential_status",
      "last_validated_at,scored_at,top500_slot_state"
    ].join(","))
    .in("county", COUNTIES)
    .eq("sales_status","new")
    .neq("review_status","rejected")
    .limit(1000);

  if (error) return { ok:false, error:error.message, opportunities:[], contractor_priority:apexPriority };

  const rows = (data || []).filter(r =>
    r.residential_status !== "excluded" &&
    n(r.priority_score) > 0
  );
  const s = stats(rows);
  const ranked = rows
    .map(row => ({ row, opportunity_score: opportunityScore(row, s) }))
    .sort((a,b) => b.opportunity_score - a.opportunity_score)
    .slice(0, Math.min(10, Math.max(1, Number(limit) || 10)))
    .map((x) => ({
      id:x.row.id, address:x.row.address, city:x.row.city, county:x.row.county,
      state:x.row.state || "MN", zip:x.row.zip, lat:x.row.lat, lon:x.row.lon,
      opportunity_score:x.opportunity_score,
      existing_priority_score:n(x.row.priority_score),
      evidence_score:n(x.row.evidence_score),
      confidence_score:n(x.row.confidence_score),
      validation_score:n(x.row.validation_score),
      assessed_value:x.row.assessed_value,
      roof_visual_score:n(x.row.roof_visual_score),
      permit_within_10y:!!x.row.permit_within_10y,
      permit_history_count:n(x.row.permit_history_count),
      residential_status:x.row.residential_status || "unknown",
      evidence_categories:x.row.evidence_categories || [],
      evidence_breakdown:x.row.evidence_breakdown || {},
      last_validated_at:x.row.last_validated_at,
      scored_at:x.row.scored_at,
      top500_slot_state:x.row.top500_slot_state || null,
      ranking_basis:[
        "existing priority score",
        "evidence score",
        "assessed value when present",
        "roof visual score when present",
        "validation score when present",
        "evidence completeness",
        "storm signal when present"
      ]
    }));

  return {
    ok:true,
    generated_at:new Date().toISOString(),
    count:ranked.length,
    opportunities:routeContractor(ranked),
    contractor_priority:{
      ...apexPriority,
      policy:"Apex Roofing is contractor priority #1. This does not fabricate property evidence or claim Apex is the highest-scoring property."
    }
  };
}
