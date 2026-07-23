import { supabaseServer } from "../supabaseServer";
import { callVisionModel } from "../aiClient";

/**
 * #12 Trust & Quality Platform
 *
 * Real AI audit: compares the job's "before" damage summary (captured at
 * job-creation time via /api/damage-annotate, stored on jobs.damage_summary)
 * against a contractor-submitted after-photo, flags mismatches between
 * claimed repair and visible result. Plus a satisfaction tracker and a
 * corrective-action recommender for anything flagged.
 */

const AUDIT_PROMPT = `You are a quality-audit AI for a roofing marketplace. You will be shown a
"before" description of damage and an "after" photo submitted by the contractor as proof of
completed repair. Determine whether the after-photo is consistent with the claimed repair.
Respond with ONLY JSON:
{
  "consistent": boolean,
  "confidence": number (0-1),
  "issues": [string],
  "recommendation": "approve" | "request_more_photos" | "flag_for_human_review"
}
Be conservative — if the photo is blurry, doesn't show the roof, or doesn't clearly show the
claimed repair area, do not approve; recommend more photos or human review instead.`;

export async function auditCompletedJob(jobId, { base64Image, mediaType }) {
  const supabase = supabaseServer();
  if (!supabase) throw new Error("Supabase not configured.");
  const { data: job } = await supabase.from("jobs").select("*").eq("id", jobId).single();
  if (!job) throw new Error("Job not found");

  const damage = job.damage_summary?.damage || [];
  const beforeSummary = damage.length
    ? damage.map((d) => `${d.type} (${d.severity}): ${d.description}`).join("\n")
    : `AI damage score at job creation: ${job.findings_score ?? "not recorded"}/100 (no itemized findings on file).`;

  const prompt = `${AUDIT_PROMPT}\n\nClaimed damage before repair:\n${beforeSummary}\n\nDoes the after-photo show this addressed? Respond with JSON only.`;
  const { text, provider } = await callVisionModel({ base64Image, mediaType, prompt });

  let result;
  try { result = JSON.parse(text.replace(/```json|```/g, "").trim()); }
  catch { result = { consistent: null, confidence: 0, issues: ["Could not parse audit response."], recommendation: "flag_for_human_review" }; }

  await supabase.from("job_audits").insert({
    job_id: jobId, consistent: result.consistent, confidence: result.confidence,
    issues: result.issues, recommendation: result.recommendation,
  });

  if (result.recommendation === "flag_for_human_review") {
    await supabase.from("jobs").update({ quality_flag: true, quality_flag_reason: (result.issues || []).join("; ") }).eq("id", jobId);
  }

  return { ...result, provider };
}

/** Records a customer satisfaction score (1-5). */
export async function recordSatisfaction(jobId, { score, comment }) {
  const supabase = supabaseServer();
  if (!supabase) throw new Error("Supabase not configured.");
  const { data: existing } = await supabase.from("job_audits").select("id").eq("job_id", jobId).order("audited_at", { ascending: false }).limit(1).maybeSingle();

  if (existing) {
    await supabase.from("job_audits").update({ satisfaction_score: score, satisfaction_comment: comment }).eq("id", existing.id);
  } else {
    await supabase.from("job_audits").insert({ job_id: jobId, satisfaction_score: score, satisfaction_comment: comment });
  }

  if (score <= 2) {
    await supabase.from("jobs").update({ quality_flag: true, quality_flag_reason: `Low satisfaction score (${score}): ${comment || "no comment"}` }).eq("id", jobId);
  }
}

/** Corrective-action recommendations for anything currently flagged. */
export async function getFlaggedJobs() {
  const supabase = supabaseServer();
  if (!supabase) return [];
  const { data, error } = await supabase.from("jobs").select("*, contractors(name, phone)").eq("quality_flag", true);
  if (error) throw new Error(error.message);
  return (data || []).map((j) => ({
    job_id: j.id, address: j.address,
    contractor: j.contractors?.name,
    reason: j.quality_flag_reason,
    recommended_action: recommendAction(j.quality_flag_reason),
  }));
}

function recommendAction(reason = "") {
  if (reason.includes("satisfaction")) return "Contact customer directly, offer re-inspection at no charge.";
  if (reason.includes("inconsistent") || reason.includes("flag_for_human_review")) return "Request additional photos from contractor before releasing payout.";
  if (reason.includes("cancellation")) return "Review contractor's recent job history before further dispatch.";
  return "Manual review needed.";
}
