import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/utils/supabase/server";
import { requireApiKey } from "@/lib/auth";
export const dynamic = "force-dynamic";

// Reads top500_crawler_lanes (already configured: competition, residential,
// permits, imagery, storm, damage, development — each with its own
// interval_seconds) and top500_slots (the occupied ones), and inserts a
// top500_crawler_tasks row for any slot/lane pair that's due — i.e. never
// investigated, or past next_investigation_at, and not already queued.
//
// This is the piece that was entirely missing: top500_crawler_tasks had
// zero rows despite 500 filled slots and 7 enabled lanes.

export async function POST(request: NextRequest) {
  const authError = requireApiKey(request);
  if (authError) return authError;

  const supabase = createServiceClient();
  const body = await request.json().catch(() => ({}));
  const limitSlots: number = body?.limit_slots ?? 500;

  const { data: lanes, error: laneError } = await supabase
    .from("top500_crawler_lanes")
    .select("lane_name, enabled, interval_seconds, priority")
    .eq("enabled", true);

  if (laneError) return NextResponse.json({ error: laneError.message }, { status: 500 });

  const { data: slots, error: slotError } = await supabase
    .from("top500_slots")
    .select("slot_no, property_id, next_investigation_at")
    .not("property_id", "is", null)
    .lte("slot_no", limitSlots)
    .order("slot_no", { ascending: true });

  if (slotError) return NextResponse.json({ error: slotError.message }, { status: 500 });

  const { data: existingQueued } = await supabase
    .from("top500_crawler_tasks")
    .select("slot_no, lane_name")
    .eq("status", "queued");

  const alreadyQueued = new Set(
    (existingQueued ?? []).map((t) => `${t.slot_no}:${t.lane_name}`)
  );

  const now = new Date();
  const toInsert: any[] = [];

  for (const slot of slots ?? []) {
    const due = !slot.next_investigation_at || new Date(slot.next_investigation_at) <= now;
    if (!due) continue;

    for (const lane of lanes ?? []) {
      const key = `${slot.slot_no}:${lane.lane_name}`;
      if (alreadyQueued.has(key)) continue;

      toInsert.push({
        slot_no: slot.slot_no,
        property_id: slot.property_id,
        lane_name: lane.lane_name,
        priority: lane.priority,
        status: "queued",
        available_at: now.toISOString(),
      });
    }
  }

  if (toInsert.length === 0) {
    return NextResponse.json({ created: 0, message: "Nothing due" });
  }

  const { error: insertError, count } = await supabase
    .from("top500_crawler_tasks")
    .insert(toInsert, { count: "exact" });

  if (insertError) return NextResponse.json({ error: insertError.message }, { status: 500 });

  return NextResponse.json({ created: count ?? toInsert.length });
}
