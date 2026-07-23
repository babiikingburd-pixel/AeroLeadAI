import { supabaseServer } from "../supabaseServer";

/**
 * #17 AI Strategic Advisor
 *
 * HONESTY NOTE: this computes real recommendations from whatever data
 * actually exists in your tables. With zero or few completed jobs, the
 * recommendations will be generic and low-confidence — that's not a bug,
 * it's the function correctly refusing to invent false precision. Every
 * recommendation returns a confidence + sample_size so it's visible when
 * a result is actually trustworthy vs. still just a heuristic placeholder.
 *
 * Adapted to what this schema actually tracks: damage "type" here means the
 * scored domain (roof/tree/driveway), not a granular taxonomy
 * (missing_shingles, hail_impact, etc.) — that granularity only exists
 * transiently from /api/damage-annotate, it isn't persisted per-lead.
 */

const DOMAINS = ["roof", "tree", "driveway"];

export async function recommendRecruitmentTargets() {
  const supabase = supabaseServer();
  if (!supabase) return { confidence: "low", sample_size: 0, recommendation: "Supabase not configured." };
  const { data: leads } = await supabase.from("batch_leads").select("roof_score, tree_score, driveway_score").neq("sales_status", "new");
  const { data: contractors } = await supabase.from("contractors").select("service_types").eq("active", true);

  if (!leads || leads.length < 20) {
    return { confidence: "low", sample_size: leads?.length || 0, recommendation: "Not enough qualified leads yet to identify real demand gaps — this will sharpen as volume grows." };
  }

  const demandByDomain = {};
  DOMAINS.forEach((d) => { demandByDomain[d] = leads.filter((l) => (l[`${d}_score`] ?? 0) >= 50).length; });

  const supplyByDomain = {};
  DOMAINS.forEach((d) => { supplyByDomain[d] = (contractors || []).filter((c) => (c.service_types || []).includes(d)).length; });

  const gaps = DOMAINS.map((d) => ({ domain: d, demand: demandByDomain[d], supply: supplyByDomain[d], gap_ratio: demandByDomain[d] / Math.max(supplyByDomain[d] || 0.5, 0.5) }))
    .sort((a, b) => b.gap_ratio - a.gap_ratio);

  return {
    confidence: leads.length > 100 ? "high" : "medium",
    sample_size: leads.length,
    recommendation: gaps[0] ? `Highest unmet demand: ${gaps[0].domain} (${gaps[0].demand} high-score lead(s) vs ${gaps[0].supply} contractor(s) who service it). Recruit here first.` : "No clear leader yet.",
    full_breakdown: gaps,
  };
}

export async function recommendMarketEntry() {
  const supabase = supabaseServer();
  if (!supabase) return { confidence: "low", sample_size: 0, recommendation: "Supabase not configured." };
  const { data: leads } = await supabase.from("batch_leads").select("zip").not("zip", "is", null);
  if (!leads || leads.length < 50) {
    return { confidence: "low", sample_size: leads?.length || 0, recommendation: "Not enough property density data yet to recommend new markets with confidence." };
  }

  const byZip = {};
  leads.forEach((l) => { byZip[l.zip] = (byZip[l.zip] || 0) + 1; });
  const ranked = Object.entries(byZip).sort((a, b) => b[1] - a[1]).slice(0, 5);

  return {
    confidence: leads.length > 500 ? "high" : "medium",
    sample_size: leads.length,
    recommendation: ranked[0] ? `Highest property density: ZIP ${ranked[0][0]} (${ranked[0][1]} properties). Consider prioritizing expansion there.` : "No clear leader yet.",
    top_regions: ranked.map(([zip, count]) => ({ zip, property_count: count })),
  };
}

/** Ranked by ZIP rather than damage type — this schema tracks job location, not a per-job damage-type breakdown. */
export async function recommendHighestROIOpportunities() {
  const supabase = supabaseServer();
  if (!supabase) return { confidence: "low", sample_size: 0, recommendation: "Supabase not configured." };
  const { data: jobs } = await supabase.from("jobs").select("*").eq("status", "completed");
  if (!jobs || jobs.length < 15) {
    return { confidence: "low", sample_size: jobs?.length || 0, recommendation: "Not enough completed jobs yet to calculate reliable ROI by region." };
  }

  const byZip = {};
  for (const j of jobs) {
    const zip = j.zip || "unknown";
    byZip[zip] = byZip[zip] || { total_revenue: 0, count: 0 };
    byZip[zip].total_revenue += j.revenue_actual || j.revenue_estimate || 0;
    byZip[zip].count += 1;
  }

  const ranked = Object.entries(byZip).map(([zip, s]) => ({ zip, avg_revenue_usd: Math.round(s.total_revenue / s.count), count: s.count })).sort((a, b) => b.avg_revenue_usd - a.avg_revenue_usd);

  return {
    confidence: jobs.length > 100 ? "high" : "medium",
    sample_size: jobs.length,
    recommendation: ranked[0] ? `Highest average revenue per job: ZIP ${ranked[0].zip} (avg $${ranked[0].avg_revenue_usd.toLocaleString()}). Prioritize marketing/dispatch toward this area.` : "No clear leader yet.",
    full_breakdown: ranked,
  };
}
