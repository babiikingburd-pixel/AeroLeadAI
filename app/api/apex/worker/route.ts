import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/utils/supabase/server";
import { requireApiKey } from "@/lib/auth";
import { runLane, fetchLead } from "@/lib/apex/lanes";
export const dynamic = "force-dynamic";

// Claims a batch of queued top500_crawler_tasks, executes the real lane
// logic in lib/apex/lanes.ts, writes results to top500_crawler_findings
// AND apex_evidence_events (both already exist), then marks the task
// completed/failed. This is the "worker" the video's investigation critique
// says never existed — it now runs against the real schema, not a new one.

export async function POST(request: NextRequest) {
  const authError = requireApiKey(request);
  if (authError) return authError;

  const supabase = createServiceClient();
  const body = await request.json().catch(() => ({}));
  const batchSize: number = body?.batch_size ?? 25;
  const workerId = `worker-${Math.random().toString(36).slice(2, 10)}`;

  const { data: claimed, error: claimError } = await supabase
    .from("top500_crawler_tasks")
    .select("task_id, slot_no, property_id, lane_name")
    .eq("status", "queued")
    .order("priority", { ascending: false })
    .limit(batchSize);

  if (claimError) return NextResponse.json({ error: claimError.message }, { status: 500 });
  if (!claimed || claimed.length === 0) {
    return NextResponse.json({ processed: 0, message: "No queued tasks" });
  }

  const taskIds = claimed.map((t) => t.task_id);
  await supabase
    .from("top500_crawler_tasks")
    .update({ status: "running", locked_by: workerId, locked_at: new Date().toISOString() })
    .in("task_id", taskIds);

  let completed = 0;
  let failed = 0;

  for (const task of claimed) {
    try {
      const lead = await fetchLead(supabase, task.property_id);
      if (!lead) throw new Error("Lead not found in batch_leads");

      const result = await runLane(task.lane_name, lead);

      await supabase.from("top500_crawler_findings").insert({
        slot_no: task.slot_no,
        property_id: task.property_id,
        lane_name: task.lane_name,
        source: `apex-worker/${task.lane_name}`,
        claim: result.claim,
        evidence: result.evidence,
        confidence: result.confidence,
        verification_status: result.verification_status,
      });

      await supabase.from("apex_evidence_events").insert({
        property_id: task.property_id,
        category: task.lane_name,
        source: `apex-worker`,
        claim: result.claim,
        value: result.evidence,
        confidence: result.confidence,
        freshness: 100,
        verification_status: result.verification_status,
      });

      await supabase
        .from("top500_crawler_tasks")
        .update({ status: "completed", finished_at: new Date().toISOString(), evidence_written: 1 })
        .eq("task_id", task.task_id);

      completed++;
    } catch (err) {
      await supabase
        .from("top500_crawler_tasks")
        .update({
          status: "failed",
          finished_at: new Date().toISOString(),
          last_error: (err as Error).message,
          attempts: 1,
        })
        .eq("task_id", task.task_id);
      failed++;
    }
  }

  const touchedSlots = Array.from(new Set(claimed.map((t) => t.slot_no)));
  await supabase
    .from("top500_slots")
    .update({ last_investigated_at: new Date().toISOString() })
    .in("slot_no", touchedSlots);

  return NextResponse.json({ processed: claimed.length, completed, failed, worker_id: workerId });
}
