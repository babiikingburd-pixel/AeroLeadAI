import { supabaseServer } from "../../../lib/supabaseServer";

// POST /api/lead-review
// body: { id: string, status: 'approved'|'partial'|'rejected'|'needs_images', notes?: string, adjustment?: number }
//
// This is the human-review step that sits in the MIDDLE of the pipeline
// (permit -> storm -> evidence -> property value -> human review ->
// priority), not bolted on after. Setting review_status here is what
// lets /api/top-leads suppress a rejected lead's priority score and lets
// tier=contractor only pull review_status='approved' leads.

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
    .from("batch_leads")
    .update({
      review_status: status,
      review_status_updated_at: new Date().toISOString(),
      human_review_notes: notes ?? null,
    })
    .eq("id", id);

  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });

  return Response.json({ ok: true, id, status });
}
