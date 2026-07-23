import { supabaseServer } from "../../../../lib/supabaseServer";

function daysBetween(a, b) {
  return (new Date(b) - new Date(a)) / (1000 * 60 * 60 * 24);
}

// Computes acceptance rate, completion rate, and avg turnaround from this
// contractor's job history, rolls it into a 0-100 performance_score, and
// persists that score onto contractors.performance_score — which is what
// the workflow's DISPATCH stage ranks contractors by. Called from the
// portal on load; also safe to hit on a schedule to keep scores fresh.
//
// Honest limit: this reads jobs currently/previously pointed at this
// contractor_id — once a decline is followed by reassignment to someone
// else, that job moves out of this contractor's queryable history, so a
// long-past decline won't show up here forever. A dedicated job-offer
// audit table would fix that; not built here.
export async function GET(req) {
  try {
    const supabase = supabaseServer();
    if (!supabase) return Response.json({ error: "Supabase not configured." }, { status: 500 });

    const code = new URL(req.url).searchParams.get("code");
    const { data: contractor } = await supabase.from("contractors").select("*").eq("portal_access_code", code).maybeSingle();
    if (!contractor) return Response.json({ error: "Invalid access code." }, { status: 401 });

    const { data: jobs } = await supabase.from("jobs").select("*").eq("contractor_id", contractor.id);
    const list = jobs || [];

    const accepted = list.filter((j) => j.contractor_response === "accepted");
    const declined = list.filter((j) => j.contractor_response === "declined");
    const completed = list.filter((j) => j.status === "completed");

    const respondedCount = accepted.length + declined.length;
    const acceptanceRate = respondedCount ? accepted.length / respondedCount : null;
    const completionRate = accepted.length ? completed.length / accepted.length : null;

    const turnarounds = completed
      .filter((j) => j.contractor_responded_at && j.completed_date)
      .map((j) => daysBetween(j.contractor_responded_at, j.completed_date))
      .filter((d) => Number.isFinite(d) && d >= 0);
    const avgTurnaroundDays = turnarounds.length ? turnarounds.reduce((s, d) => s + d, 0) / turnarounds.length : null;

    let performanceScore = null;
    if (acceptanceRate != null || completionRate != null || avgTurnaroundDays != null) {
      const turnaroundFactor = avgTurnaroundDays != null ? Math.max(0, Math.min(1, 1 - avgTurnaroundDays / 30)) : 0.5;
      const score = (acceptanceRate ?? 0.5) * 0.4 + (completionRate ?? 0.5) * 0.4 + turnaroundFactor * 0.2;
      performanceScore = Math.round(score * 100);
      await supabase.from("contractors").update({ performance_score: performanceScore }).eq("id", contractor.id);
    }

    return Response.json({
      contractor_id: contractor.id,
      jobs_assigned: list.length,
      jobs_accepted: accepted.length,
      jobs_declined: declined.length,
      jobs_completed: completed.length,
      acceptance_rate: acceptanceRate,
      completion_rate: completionRate,
      avg_turnaround_days: avgTurnaroundDays,
      performance_score: performanceScore,
    });
  } catch (e) {
    return Response.json({ error: e?.message || "Unknown server error" }, { status: 500 });
  }
}
