import { supabaseServer } from "../../../lib/supabaseServer";
export const dynamic = "force-dynamic";

const VALID_STATUSES = ["pending", "approved", "rejected", "needs_rescan"];

export async function GET(req) {
  const supabase = supabaseServer();
  if (!supabase) {
    return Response.json({ ok: false, error: "Supabase not configured.", rows: [] });
  }

  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status");

  let query = supabase.from("image_review_queue").select("*").order("national_rank", { ascending: true });
  if (status && VALID_STATUSES.includes(status)) {
    query = query.eq("review_status", status);
  }

  const { data, error } = await query;
  if (error) {
    return Response.json({ ok: false, error: error.message, rows: [] }, { status: 500 });
  }
  return Response.json({ ok: true, rows: data });
}

export async function PATCH(req) {
  const supabase = supabaseServer();
  if (!supabase) {
    return Response.json({ ok: false, error: "Supabase not configured." }, { status: 500 });
  }

  const body = await req.json();
  const { id, review_status, reviewer_notes } = body;
  if (!id) return Response.json({ ok: false, error: "id is required." }, { status: 400 });
  if (review_status && !VALID_STATUSES.includes(review_status)) {
    return Response.json({ ok: false, error: `review_status must be one of: ${VALID_STATUSES.join(", ")}` }, { status: 400 });
  }

  const update = { ...(review_status && { review_status, reviewed_at: new Date().toISOString() }), ...(reviewer_notes !== undefined && { reviewer_notes }) };

  const { data, error } = await supabase.from("image_review_queue").update(update).eq("id", id).select();
  if (error) {
    return Response.json({ ok: false, error: error.message }, { status: 500 });
  }
  return Response.json({ ok: true, row: data?.[0] ?? null });
}
