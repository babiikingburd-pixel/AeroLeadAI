import { supabaseServer } from "../../../lib/supabaseServer";
export const dynamic = "force-dynamic";

// POST /api/lead-review
// body: { id: string, status: 'approved'|'partial'|'rejected'|'needs_images', notes?: string, adjustment?: number }
//
// Human review annotates the active Oversight profile. It does not gate the
// collection leaderboard; approved profiles are simply shown first in the
// contractor package.

const VALID = ["approved", "partial", "rejected", "needs_images", "pending"];

export async function POST(req) {
  const supabase = supabaseServer();
  if (!supabase) return Response.json({ ok: false, error: "Supabase not configured." }, { status: 500 });

  const body = await req.json();
  const { id, status, notes } = body;

  if (!id || !VALID.includes(status)) {
    return Response.json({ ok: false, error: `id required; status must be one of ${VALID.join(", ")}` }, { status: 400 });
  }

  const { error } = await supabase
    .from("roof_profiles")
    .update({
      review_status: status,
      review_status_updated_at: new Date().toISOString(),
      human_review_notes: notes ?? null,
    })
    .eq("parcel_id", id);

  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });

  return Response.json({ ok: true, id, status });
}
