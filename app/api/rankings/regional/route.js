import { supabaseServer } from "../../../../lib/supabaseServer";

const VALID_REGIONS = ["East", "Midwest", "South", "West"];

// Backs the Regional leaderboard tabs. Reads the `regional_priority_rankings`
// Supabase view (already pre-ranked per region, column regional_rank).
export async function GET(req) {
  const supabase = supabaseServer();
  if (!supabase) {
    return Response.json({ ok: false, error: "Supabase not configured.", rows: [] });
  }

  const { searchParams } = new URL(req.url);
  const region = searchParams.get("region");
  if (!VALID_REGIONS.includes(region)) {
    return Response.json({ ok: false, error: `region must be one of: ${VALID_REGIONS.join(", ")}`, rows: [] }, { status: 400 });
  }

  const requestedLimit = parseInt(searchParams.get("limit"), 10);
  const limit = requestedLimit === 200 ? 200 : 100;

  const { data, error } = await supabase
    .from("regional_priority_rankings")
    .select("*")
    .eq("region", region)
    .lte("regional_rank", limit)
    .order("regional_rank", { ascending: true });

  if (error) {
    return Response.json({ ok: false, error: error.message, rows: [] }, { status: 500 });
  }

  return Response.json({ ok: true, rows: data, limit, region });
}
