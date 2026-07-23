import { supabaseServer } from "../../../../lib/supabaseServer";

// Contractor portal auth is intentionally a placeholder — a per-contractor
// unguessable code (contractors.portal_access_code, same shape as
// jobs.share_token), not a real login/session system. See README "Honest
// gaps". Every route in app/api/contractor/* re-validates this code itself
// rather than trusting a client-cached contractor_id.
async function contractorForCode(supabase, code) {
  if (!code) return null;
  const { data } = await supabase.from("contractors").select("*").eq("portal_access_code", code).maybeSingle();
  return data || null;
}

export async function GET(req) {
  try {
    const supabase = supabaseServer();
    if (!supabase) return Response.json({ error: "Supabase not configured." }, { status: 500 });

    const code = new URL(req.url).searchParams.get("code");
    const contractor = await contractorForCode(supabase, code);
    if (!contractor) return Response.json({ error: "Invalid access code." }, { status: 401 });

    const { data: jobs, error } = await supabase.from("jobs").select("*").eq("contractor_id", contractor.id).order("scheduled_date", { ascending: true, nullsFirst: false });
    if (error) return Response.json({ error: error.message }, { status: 500 });

    return Response.json({ contractor: { id: contractor.id, name: contractor.name }, jobs: jobs || [] });
  } catch (e) {
    return Response.json({ error: e?.message || "Unknown server error" }, { status: 500 });
  }
}
