import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/utils/supabase/server";
import { requireApiKey } from "@/lib/auth";
export const dynamic = "force-dynamic";

// Fills the EXISTING top500_slots table (it has 500 rows, but they start
// empty — property_id null, status 'open') from batch_leads ranked by the
// already-populated priority_score column. Idempotent: re-running just
// re-ranks. Does not create any table.

export async function POST(request: NextRequest) {
  const authError = requireApiKey(request);
  if (authError) return authError;

  const supabase = createServiceClient();

  const { data: ranked, error: rankError } = await supabase
    .from("batch_leads")
    .select("id, priority_score")
    .gt("priority_score", 0)
    .or("opted_out.is.null,opted_out.eq.false")
    .order("priority_score", { ascending: false })
    .limit(500);

  if (rankError) {
    return NextResponse.json({ error: rankError.message }, { status: 500 });
  }

  let updated = 0;
  for (let i = 0; i < (ranked?.length ?? 0); i++) {
    const row = ranked![i];
    const slotNo = i + 1;
    const { error: updateError } = await supabase
      .from("top500_slots")
      .update({
        property_id: row.id,
        rank: slotNo,
        score: row.priority_score,
        status: "assigned",
        assigned_at: new Date().toISOString(),
        next_investigation_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("slot_no", slotNo);

    if (!updateError) updated++;
  }

  return NextResponse.json({ seeded: updated, requested: ranked?.length ?? 0 });
}
