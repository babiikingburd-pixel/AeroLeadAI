import { supabaseServer } from "../../../../../lib/supabaseServer";

const ACTIONS = ["accept", "decline", "complete"];

export async function PATCH(req, { params }) {
  try {
    const supabase = supabaseServer();
    if (!supabase) return Response.json({ error: "Supabase not configured." }, { status: 500 });

    const { code, action } = await req.json();
    if (!ACTIONS.includes(action)) return Response.json({ error: `Unknown action. Use one of: ${ACTIONS.join(", ")}` }, { status: 400 });

    const { data: contractor } = await supabase.from("contractors").select("*").eq("portal_access_code", code).maybeSingle();
    if (!contractor) return Response.json({ error: "Invalid access code." }, { status: 401 });

    const { data: job } = await supabase.from("jobs").select("*").eq("id", params.id).maybeSingle();
    if (!job || job.contractor_id !== contractor.id) return Response.json({ error: "Job not found or not assigned to you." }, { status: 404 });

    if (action === "accept") {
      const { data, error } = await supabase.from("jobs")
        .update({ contractor_response: "accepted", contractor_responded_at: new Date().toISOString() })
        .eq("id", job.id).select().single();
      if (error) return Response.json({ error: error.message }, { status: 500 });
      return Response.json({ job: data });
    }

    if (action === "decline") {
      // Unassign so the next workflow sweep's DISPATCH stage can offer this
      // job to a different contractor instead of re-offering it to this one.
      const { data, error } = await supabase.from("jobs")
        .update({ contractor_response: "declined", contractor_responded_at: new Date().toISOString() })
        .eq("id", job.id).select().single();
      if (error) return Response.json({ error: error.message }, { status: 500 });
      return Response.json({ job: data });
    }

    if (action === "complete") {
      if (job.contractor_response !== "accepted") {
        return Response.json({ error: "Accept the job before marking it complete." }, { status: 400 });
      }
      const { data, error } = await supabase.from("jobs")
        .update({ status: "completed", completed_date: new Date().toISOString().slice(0, 10) })
        .eq("id", job.id).select().single();
      if (error) return Response.json({ error: error.message }, { status: 500 });
      await supabase.from("contractors").update({ jobs_completed: (contractor.jobs_completed || 0) + 1 }).eq("id", contractor.id);
      return Response.json({ job: data });
    }
  } catch (e) {
    return Response.json({ error: e?.message || "Unknown server error" }, { status: 500 });
  }
}
