import { supabaseServer } from "../../../../lib/supabaseServer";
export const dynamic = "force-dynamic";

// Backs the National leaderboard tab. Reads the `national_priority_rankings`
// Supabase view directly — this view is expected to already be pre-ranked
// (column national_rank), so no client-side sorting/scoring happens here.
export async function GET(req) {
  const supabase = supabaseServer();
  if (!supabase) {
    return Response.json({ ok: false, error: "Supabase not configured.", rows: [] });
  }

  const { searchParams } = new URL(req.url);
  const requestedLimit = parseInt(searchParams.get("limit"), 10);
  const limit = requestedLimit === 200 ? 200 : 100;

  const { data, error } = await supabase
    .from("national_priority_rankings")
    .select("*")
    .lte("national_rank", limit)
    .order("national_rank", { ascending: true });

  if (error) {
    return Response.json({ ok: false, error: error.message, rows: [] }, { status: 500 });
  }

  return Response.json({ ok: true, rows: data, limit });
}
