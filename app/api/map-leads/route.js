import { supabaseServer } from "../../../lib/supabaseServer";
export const dynamic = "force-dynamic";

// Feeds the /map Lead Map with the batch_leads table (the /batch pipeline's
// durable, cross-device queue — 18k+ rows in production). The map previously
// only ever read localStorage via importConsoleProperties(), so it showed
// whatever happened to be in that one browser's storage (often near-zero)
// instead of the real scanned dataset. This route is the fix: a real query
// against batch_leads, paginated past PostgREST's default 1000-row cap.

export const maxDuration = 60;

const PAGE_SIZE = 1000;
// Safety ceiling only, not a display cap — every geocoded lead must show on
// the map regardless of tier (hot/cold/low-priority/unscored all matter for
// coverage), so this isn't allowed to silently truncate the real dataset.
// The loop below stops naturally once a page comes back short; this just
// bounds worst-case pagination if the table were ever unexpectedly huge.
const MAX_ROWS = 50000;

export async function GET() {
  const supabase = supabaseServer();
  if (!supabase) {
    return Response.json({ ok: false, error: "Supabase not configured.", leads: [], total: 0, truncated: false });
  }

  const { count, error: countError } = await supabase
    .from("batch_leads")
    .select("id", { count: "exact", head: true })
    .not("lat", "is", null)
    .not("lon", "is", null);

  if (countError) {
    return Response.json({ ok: false, error: countError.message, leads: [], total: 0, truncated: false }, { status: 500 });
  }

  const rows = [];
  for (let offset = 0; offset < MAX_ROWS; offset += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("batch_leads")
      .select("address, lat, lon, roof_score, tree_score, driveway_score, permit_within_10y, sales_status, city, zip, updated_at")
      .not("lat", "is", null)
      .not("lon", "is", null)
      .order("updated_at", { ascending: false })
      .range(offset, offset + PAGE_SIZE - 1);

    if (error) {
      return Response.json({ ok: false, error: error.message, leads: rows, total: count ?? rows.length, truncated: true }, { status: 500 });
    }
    rows.push(...data);
    if (data.length < PAGE_SIZE) break; // fewer rows than a full page means we've reached the end
  }

  return Response.json({
    ok: true,
    leads: rows,
    total: count ?? rows.length,
    truncated: (count ?? 0) > rows.length,
  });
}
