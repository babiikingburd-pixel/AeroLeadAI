import { supabaseServer } from "../supabaseServer";

/**
 * #19 Platform Intelligence Network
 *
 * Aggregates operational data into benchmarks: nobody's individual
 * completion rate, revenue, or identity is exposed — only cohort-level
 * medians a contractor or region can compare against. Every function
 * refuses to return a result for cohorts smaller than MIN_COHORT_SIZE, to
 * avoid re-identifying a single contractor.
 *
 * Privacy note: this only aggregates data already collected for operational
 * purposes. Before ever sharing these benchmarks externally (e.g. an
 * industry report), review against your state's data privacy requirements
 * and your own contractor agreements first — that's a legal/compliance
 * check, not something this code can verify for you.
 */

const MIN_COHORT_SIZE = 5;
const DOMAINS = ["roof", "tree", "driveway"];

export async function getContractorBenchmark(contractorId) {
  const supabase = supabaseServer();
  if (!supabase) return { available: false, reason: "Supabase not configured." };
  const { data: contractor } = await supabase.from("contractors").select("*").eq("id", contractorId).single();
  if (!contractor) throw new Error("Contractor not found");

  const { data: peers } = await supabase.from("contractors").select("id, service_types").overlaps("service_types", contractor.service_types || []).neq("id", contractorId);
  if (!peers || peers.length < MIN_COHORT_SIZE) {
    return { available: false, reason: `Cohort too small (${peers?.length || 0}) to benchmark without risking re-identification.` };
  }

  const { data: jobs } = await supabase.from("jobs").select("contractor_id, status").in("contractor_id", [contractorId, ...peers.map((p) => p.id)]);
  const rateFor = (id) => {
    const cJobs = (jobs || []).filter((j) => j.contractor_id === id);
    if (!cJobs.length) return null;
    return Math.round((cJobs.filter((j) => j.status === "completed").length / cJobs.length) * 100);
  };

  const yourRate = rateFor(contractorId);
  const peerRates = peers.map((p) => rateFor(p.id)).filter((r) => r !== null).sort((a, b) => a - b);
  if (peerRates.length < MIN_COHORT_SIZE) return { available: false, reason: "Not enough peer job history yet to benchmark." };

  const percentile = yourRate !== null ? peerRates.filter((r) => r <= yourRate).length / peerRates.length : null;
  return {
    available: true,
    your_completion_rate_pct: yourRate,
    cohort_median_pct: peerRates[Math.floor(peerRates.length / 2)],
    your_percentile: percentile !== null ? Math.round(percentile * 100) : null,
    cohort_size: peerRates.length,
  };
}

/** Seasonal pattern for a domain (roof/tree/driveway) — which month sees the most scored damage. */
export async function getSeasonalDemandPattern(domain) {
  const supabase = supabaseServer();
  if (!supabase) return { available: false, reason: "Supabase not configured." };
  if (!DOMAINS.includes(domain)) throw new Error(`domain must be one of ${DOMAINS.join(", ")}`);
  const scoreCol = `${domain}_score`;
  const { data: leads } = await supabase.from("batch_leads").select(`created_at, ${scoreCol}`).not(scoreCol, "is", null);

  if (!leads || leads.length < 30) return { available: false, reason: "Not enough historical volume yet to identify a reliable seasonal pattern." };

  const byMonth = new Array(12).fill(0);
  leads.forEach((l) => byMonth[new Date(l.created_at).getMonth()]++);
  const peakMonth = byMonth.indexOf(Math.max(...byMonth));

  return { available: true, domain, sample_size: leads.length, by_month: byMonth, peak_month: new Date(2000, peakMonth).toLocaleString("default", { month: "long" }) };
}

/** Regional demand benchmark, keyed directly by ZIP (already tracked on batch_leads). */
export async function getRegionalDemandBenchmark(zip) {
  const supabase = supabaseServer();
  if (!supabase) return { available: false, reason: "Supabase not configured." };
  const { data: leads } = await supabase.from("batch_leads").select("roof_score, tree_score, driveway_score").eq("zip", zip);
  if (!leads || leads.length < MIN_COHORT_SIZE) return { available: false, reason: "Region too small to benchmark yet." };

  const scored = leads.filter((l) => l.roof_score !== null || l.tree_score !== null || l.driveway_score !== null).length;
  return { available: true, zip, property_count: leads.length, scored_count: scored, scored_rate_pct: Math.round((scored / leads.length) * 100) };
}
