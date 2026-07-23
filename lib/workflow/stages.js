import { analyzeRoof } from "../ai/roofAnalysis";
import { placeQualifyCall } from "../bland/client";
import { chargeAndPayout } from "../contractors/payments";
import { supabaseServer } from "../supabaseServer";

// Rough cutoff below which a lead isn't worth calling — same order of
// magnitude as the "cold" tier in /api/lead-score, kept as a separate
// constant here since this gate runs on the raw damage concern score, not
// the fuller sales-intelligence scorecard.
const QUALIFY_THRESHOLD = 40;

// Each handler returns one of:
//   { next: "<stage>", patch?: {...} }  — advance, optionally updating columns
//   { stay: true, patch?: {...}, note?: "..." } — stay put (waiting on an
//     external event, missing data, or unconfigured integration); patch can
//     still record incremental progress (e.g. bland_call_id).
// pipeline.js persists whatever comes back and appends to stage_history
// only on an actual stage change.
export const handlers = {
  async discover(lead) {
    if (lead.lat == null || lead.lon == null) {
      return { stay: true, note: "Missing lat/lon — cannot proceed to ANALYZE." };
    }
    return { next: "analyze" };
  },

  async analyze(lead) {
    const result = await analyzeRoof({ address: lead.address, lat: lead.lat, lon: lead.lon });
    return {
      next: "qualify",
      patch: { ai_score: result.overall_score, ai_findings: result, estimate_usd: result.estimate.total_usd },
    };
  },

  async qualify(lead) {
    if ((lead.ai_score ?? 0) < QUALIFY_THRESHOLD) {
      return { next: "dead", patch: { disqualify_reason: `AI concern score ${lead.ai_score} is below the ${QUALIFY_THRESHOLD} qualify threshold.` } };
    }
    if (!lead.phone) {
      return { stay: true, note: "Qualified, but no phone number on file yet — add one to reach CONTACT." };
    }
    return { next: "contact" };
  },

  async contact(lead) {
    if (lead.bland_call_id) {
      return { stay: true, note: "Qualify call already placed — waiting on the Bland webhook (consent + requested_time)." };
    }
    const call = await placeQualifyCall(lead);
    if (!call.available) {
      return { stay: true, note: call.reason };
    }
    if (!call.success) {
      return { stay: true, note: call.error };
    }
    return { stay: true, patch: { bland_call_id: call.call_id }, note: "Qualify call placed." };
  },

  async book(lead) {
    // Reached only once lib/bland/webhook.js has already written consent +
    // requested_time and pushed the stage here directly — this handler's
    // job is just to turn that into a real job row.
    const supabase = supabaseServer();
    if (!supabase) return { stay: true, note: "Supabase not configured — cannot create the job." };
    const { data: job, error } = await supabase.from("jobs").insert({
      address: lead.address, lat: lead.lat, lon: lead.lon, zip: lead.zip,
      status: "scheduled", scheduled_date: lead.requested_time,
      revenue_estimate: lead.estimate_usd, findings_score: lead.ai_score,
      ai_findings: lead.ai_findings,
    }).select().single();
    if (error) return { stay: true, note: `Job creation failed: ${error.message}` };
    return { next: "dispatch", patch: { job_id: job.id } };
  },

  async dispatch(lead) {
    const supabase = supabaseServer();
    if (!supabase) return { stay: true, note: "Supabase not configured." };
    if (!lead.zip) return { stay: true, note: "No ZIP on file — cannot match a contractor." };

    const { data: job } = await supabase.from("jobs").select("contractor_id, contractor_response").eq("id", lead.job_id).maybeSingle();
    if (job?.contractor_response === "accepted") {
      // Stage intentionally stays at 'dispatch' — advancing to COMPLETE is
      // an external event (the contractor marking the job done via the
      // contractor portal), not something a sweep can decide on its own.
      return { stay: true, note: "Contractor accepted — awaiting completion." };
    }

    let query = supabase.from("contractors").select("*").eq("active", true).contains("zip_coverage", [lead.zip]);
    if (job?.contractor_response === "declined" && job.contractor_id) {
      query = query.neq("id", job.contractor_id); // don't re-offer to whoever just declined
    }
    const { data: contractors } = await query.order("performance_score", { ascending: false, nullsFirst: false }).limit(1);
    const contractor = contractors?.[0];
    if (!contractor) return { stay: true, note: `No active contractor covers ZIP ${lead.zip} yet.` };

    await supabase.from("jobs").update({ contractor_id: contractor.id, contractor_response: null, contractor_responded_at: null }).eq("id", lead.job_id);
    return { stay: true, patch: { contractor_id: contractor.id }, note: "Contractor assigned — awaiting accept/decline and completion in the contractor portal." };
  },

  async complete(lead) {
    const supabase = supabaseServer();
    if (!supabase || !lead.job_id) return { stay: true, note: "No linked job yet." };
    const { data: job } = await supabase.from("jobs").select("status").eq("id", lead.job_id).maybeSingle();
    if (job?.status !== "completed") {
      return { stay: true, note: "Waiting on the contractor to mark the job complete." };
    }
    return { next: "pay" };
  },

  async pay(lead) {
    const result = await chargeAndPayout(lead);
    if (!result.available) return { stay: true, note: result.reason };
    if (!result.success) return { stay: true, note: result.error || "Payment failed." };
    return { next: "review" };
  },

  async review(lead) {
    return { stay: true, note: "Awaiting customer review submission." };
  },
};
