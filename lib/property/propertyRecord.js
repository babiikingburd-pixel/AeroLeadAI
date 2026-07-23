import { supabaseServer } from "../supabaseServer";

/**
 * #13 Unified Property Record
 *
 * The one genuinely "free" long-term asset here — every inspection, job, and
 * repair the pipeline produces gets appended to one durable record instead of
 * living only inside a single lead/job row. This is what makes the 2nd, 3rd,
 * 4th job on the same property faster: the contractor already knows roof
 * age, past repairs, past contractor.
 */

/** Get or create the canonical property record keyed by normalized address. */
export async function getOrCreateProperty({ address, lat, lon }) {
  const supabase = supabaseServer();
  if (!supabase) throw new Error("Supabase not configured.");
  const { data: existing } = await supabase.from("property_records").select("*").eq("address", address).maybeSingle();
  if (existing) return existing;

  const { data, error } = await supabase.from("property_records").insert({ address, lat, lon, history: [] }).select().single();
  if (error) throw new Error(`Property record creation failed: ${error.message}`);
  return data;
}

/** Append an event — call whenever a scan completes, a job finishes, a permit is filed, etc. */
export async function appendHistory(propertyId, event) {
  const supabase = supabaseServer();
  if (!supabase) throw new Error("Supabase not configured.");
  const { data: property } = await supabase.from("property_records").select("history").eq("id", propertyId).single();
  const history = [...(property?.history || []), { ...event, recorded_at: new Date().toISOString() }];
  const { error } = await supabase.from("property_records").update({ history }).eq("id", propertyId);
  if (error) throw new Error(`History append failed: ${error.message}`);
  return history;
}

export const HistoryEvents = {
  inspection: (findingsScore, indicators) => ({ type: "inspection", damage_found: indicators || [], score: findingsScore }),
  repair: (job) => ({ type: "repair", job_id: job.id, contractor_id: job.contractor_id, cost_cents: Math.round((job.revenue_actual || job.revenue_estimate || 0) * 100), full_replacement: !!job.full_replacement }),
  permit: (permitNumber, description) => ({ type: "permit", permit_number: permitNumber, description }),
  warranty: (contractorId, termYears, coverage) => ({ type: "warranty", contractor_id: contractorId, term_years: termYears, coverage }),
};

/** Full timeline for a property. */
export async function getPropertyTimeline(propertyId) {
  const supabase = supabaseServer();
  if (!supabase) throw new Error("Supabase not configured.");
  const { data, error } = await supabase.from("property_records").select("*").eq("id", propertyId).single();
  if (error) throw new Error("Property not found");
  return {
    address: data.address,
    roof_age_estimate: estimateRoofAge(data.history),
    timeline: (data.history || []).sort((a, b) => new Date(b.recorded_at) - new Date(a.recorded_at)),
  };
}

function estimateRoofAge(history) {
  const lastFullReplacement = (history || []).filter((h) => h.type === "repair" && h.full_replacement).sort((a, b) => new Date(b.recorded_at) - new Date(a.recorded_at))[0];
  if (!lastFullReplacement) return "unknown — no full replacement on record";
  const years = (Date.now() - new Date(lastFullReplacement.recorded_at).getTime()) / (365 * 86400000);
  return `${Math.round(years * 10) / 10} years since last full replacement`;
}
