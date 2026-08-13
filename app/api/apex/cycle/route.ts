import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/utils/supabase/server";
import { requireApiKey } from "@/lib/auth";
export const dynamic = "force-dynamic";

// Runs one APEX governance cycle: recomputes evidence_confidence and
// evidence_completeness on batch_leads for recently-investigated properties,
// then checks each against twincities_apex_controls (already configured:
// min_confidence_for_promotion=55, min_evidence_quality_for_promotion=55,
// stability_cycles=2, top_n=500) and logs the decision to
// twincities_apex_cycles + twincities_apex_decisions — both real tables
// that had zero rows before this pass ever ran.
//
// 7 evidence categories exist as lanes (competition, residential, permits,
// imagery, storm, damage, development), so completeness = categories
// covered / 7.

const TOTAL_LANES = 7;

export async function POST(request: NextRequest) {
  const authError = requireApiKey(request);
  if (authError) return authError;

  const supabase = createServiceClient();
  const body = await request.json().catch(() => ({}));
  const windowMinutes: number = body?.window_minutes ?? 30;

  const { data: controlsRows, error: controlsError } = await supabase
    .from("twincities_apex_controls")
    .select("*")
    .eq("id", 1)
    .single();

  if (controlsError || !controlsRows) {
    return NextResponse.json({ error: "Could not load twincities_apex_controls" }, { status: 500 });
  }
  const controls = controlsRows;

  if (!controls.enabled) {
    return NextResponse.json({ status: "skipped", reason: "APEX cycle disabled in twincities_apex_controls" });
  }

  const since = new Date(Date.now() - windowMinutes * 60_000).toISOString();

  const { data: recentTasks, error: taskError } = await supabase
    .from("top500_crawler_tasks")
    .select("property_id")
    .eq("status", "completed")
    .gte("finished_at", since);

  if (taskError) return NextResponse.json({ error: taskError.message }, { status: 500 });

  const propertyIds = Array.from(new Set((recentTasks ?? []).map((t) => t.property_id)));
  if (propertyIds.length === 0) {
    return NextResponse.json({ status: "no_recent_investigations", scanned: 0 });
  }

  const cycleId = `cycle-${new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 15)}`;
  let promoted = 0;
  let held = 0;

  for (const propertyId of propertyIds) {
    const { data: events } = await supabase
      .from("apex_evidence_events")
      .select("category, confidence")
      .eq("property_id", propertyId);

    if (!events || events.length === 0) continue;

    const categories = new Set(events.map((e) => e.category));
    const avgConfidence =
      events.reduce((sum, e) => sum + Number(e.confidence ?? 0), 0) / events.length;
    const completeness = Math.round((categories.size / TOTAL_LANES) * 10000) / 100;

    await supabase
      .from("batch_leads")
      .update({
        evidence_confidence: Math.round(avgConfidence * 100) / 100,
        evidence_completeness: completeness,
        last_validated_at: new Date().toISOString(),
      })
      .eq("id", propertyId);

    const decision =
      avgConfidence >= controls.min_confidence_for_promotion &&
      completeness >= controls.min_evidence_quality_for_promotion
        ? "promote"
        : "hold";

    if (decision === "promote") promoted++;
    else held++;

    await supabase.from("twincities_apex_decisions").insert({
      cycle_id: cycleId,
      lead_id: propertyId,
      decision,
      confidence: Math.round(avgConfidence * 100) / 100,
      evidence_quality: completeness,
      reason: {
        min_confidence_required: controls.min_confidence_for_promotion,
        min_evidence_quality_required: controls.min_evidence_quality_for_promotion,
        lanes_covered: Array.from(categories),
      },
    });
  }

  await supabase.from("twincities_apex_cycles").insert({
    cycle_id: cycleId,
    version: "APEX20.4",
    status: "completed",
    scanned: propertyIds.length,
    fused: propertyIds.length,
    promoted,
    demoted: 0,
    held,
    completed_at: new Date().toISOString(),
  });

  return NextResponse.json({ cycle_id: cycleId, scanned: propertyIds.length, promoted, held });
}
