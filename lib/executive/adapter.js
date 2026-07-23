import { supabaseServer } from "../supabaseServer";
import { DataAdapter } from "./dataAdapter";

// AeroLeadAIAdapter — the one business-specific file the Executive Engine
// needs. The zip's reference adapter targeted a rejected schema (jobs with a
// nested `estimate` object, a `leads` table with `stage`/`stage_history`).
// This rewrite reads the schema actually live in this app: batch_leads,
// jobs, contractors, campaigns, contractor_candidates (supabase_ops_schema.sql
// + supabase_batch_leads_schema.sql + supabase_phase2_schema.sql). Every
// method degrades to honest zeros/empty arrays if Supabase isn't configured
// rather than throwing, matching the rest of the app's graceful-degradation
// pattern.
export class AeroLeadAIAdapter extends DataAdapter {
  async getFinancials() {
    const supabase = supabaseServer();
    if (!supabase) return { available: false, reason: "Supabase not configured." };

    const { data: jobs } = await supabase.from("jobs").select("status, revenue_actual, revenue_estimate, created_at");
    const all = jobs || [];
    const completed = all.filter((j) => j.status === "completed");
    const grossRevenueUsd = completed.reduce((s, j) => s + (j.revenue_actual || j.revenue_estimate || 0), 0);
    const pipelineEstimateUsd = all
      .filter((j) => j.status !== "completed" && j.status !== "canceled")
      .reduce((s, j) => s + (j.revenue_estimate || 0), 0);

    return {
      job_count: all.length,
      completed_job_count: completed.length,
      canceled_job_count: all.filter((j) => j.status === "canceled").length,
      gross_revenue_usd: grossRevenueUsd,
      open_pipeline_estimate_usd: pipelineEstimateUsd,
      note: "Contractor payouts and margin aren't tracked as separate columns yet — this is gross revenue, not net.",
    };
  }

  async getOperationsMetrics() {
    const supabase = supabaseServer();
    if (!supabase) return { available: false, reason: "Supabase not configured." };

    const [{ data: jobs }, { data: leads }] = await Promise.all([
      supabase.from("jobs").select("status, quality_flag"),
      supabase.from("batch_leads").select("stage"),
    ]);

    const jobStatusCounts = {};
    (jobs || []).forEach((j) => (jobStatusCounts[j.status] = (jobStatusCounts[j.status] || 0) + 1));
    const leadStageCounts = {};
    (leads || []).forEach((l) => (leadStageCounts[l.stage] = (leadStageCounts[l.stage] || 0) + 1));

    return {
      jobs_by_status: jobStatusCounts,
      leads_by_pipeline_stage: leadStageCounts,
      total_jobs: jobs?.length || 0,
      total_leads: leads?.length || 0,
      quality_flagged_jobs: (jobs || []).filter((j) => j.quality_flag).length,
    };
  }

  async getMarketingMetrics() {
    const supabase = supabaseServer();
    if (!supabase) return { available: false, reason: "Supabase not configured." };

    const [{ data: campaigns }, { data: leads }] = await Promise.all([
      supabase.from("campaigns").select("name, channel, budget_cents, status").eq("status", "active"),
      supabase.from("batch_leads").select("stage, opted_out"),
    ]);

    const converted = (leads || []).filter((l) => l.stage === "done").length;

    return {
      active_campaigns: campaigns?.length || 0,
      campaigns: (campaigns || []).map((c) => ({ name: c.name, channel: c.channel, budget_cents: c.budget_cents })),
      total_leads: leads?.length || 0,
      converted_leads: converted,
      opted_out_leads: (leads || []).filter((l) => l.opted_out).length,
      conversion_rate: leads?.length ? Math.round((converted / leads.length) * 1000) / 10 : null,
    };
  }

  async getLegalItems() {
    const supabase = supabaseServer();
    if (!supabase) return { available: false, reason: "Supabase not configured." };

    const [{ data: candidates }, { data: contractors }] = await Promise.all([
      supabase.from("contractor_candidates").select("status").eq("status", "pending_verification"),
      supabase.from("contractors").select("name, insurance_expires_at, suspension_reason"),
    ]);

    const now = Date.now();
    const soon = now + 30 * 24 * 60 * 60 * 1000;
    const expiringInsurance = (contractors || []).filter(
      (c) => c.insurance_expires_at && new Date(c.insurance_expires_at).getTime() < soon
    );

    return {
      pending_contractor_verifications: candidates?.length || 0,
      contractors_with_insurance_expiring_within_30_days: expiringInsurance.map((c) => c.name),
      suspended_contractors: (contractors || []).filter((c) => c.suspension_reason).length,
      note: "No dedicated legal/compliance items table yet (contract renewals, disputes) — this reflects contractor licensing/insurance only.",
    };
  }

  async getStrategicContext() {
    const supabase = supabaseServer();
    if (!supabase) return { available: false, reason: "Supabase not configured." };

    const { data: leads } = await supabase.from("batch_leads").select("zip");
    const zipCounts = {};
    (leads || []).forEach((l) => {
      if (l.zip) zipCounts[l.zip] = (zipCounts[l.zip] || 0) + 1;
    });
    const topZips = Object.entries(zipCounts).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([zip, count]) => ({ zip, count }));

    return {
      total_lead_volume: leads?.length || 0,
      top_lead_zip_codes: topZips,
      stated_priority: "Win density in existing ZIP coverage before expanding into new metros — no competitor-tracking data source configured yet.",
    };
  }
}
