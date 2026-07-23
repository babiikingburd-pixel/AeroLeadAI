import { advanceLead, sweep } from "../../../../lib/workflow/pipeline";
import { supabaseServer } from "../../../../lib/supabaseServer";

// Call with { leadId } to advance one lead by one stage, or with no body
// (or {}) to sweep every non-terminal lead — this is what a Vercel Cron job
// or scheduled Supabase function should hit periodically to move the whole
// pipeline forward automatically.
export async function POST(req) {
  try {
    const supabase = supabaseServer();
    if (!supabase) {
      return Response.json({ error: "Supabase not configured — set NEXT_PUBLIC_SUPABASE_URL and a key (see .env.example)." }, { status: 500 });
    }

    let body = {};
    try { body = await req.json(); } catch { /* empty body = sweep */ }

    if (body.leadId) {
      const { data: lead, error } = await supabase.from("leads").select("*").eq("id", body.leadId).maybeSingle();
      if (error || !lead) return Response.json({ error: "Lead not found." }, { status: 404 });
      const result = await advanceLead(lead);
      return Response.json(result);
    }

    const results = await sweep();
    return Response.json({ swept: results.length, results });
  } catch (e) {
    return Response.json({ error: e?.message || "Unknown server error" }, { status: 500 });
  }
}
