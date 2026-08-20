import { NextRequest, NextResponse } from "next/server";
import { requireApiKey } from "@/lib/auth";
export const dynamic = "force-dynamic";

// Single entry point that runs the full loop the video described:
// generate due tasks -> run a worker batch -> run one governance cycle.
// Call this on a schedule (Vercel Cron, or your Claude Code session's
// existing scheduler) instead of running the three steps by hand.
//
// Does NOT run /api/apex/seed automatically — seeding (re-ranking all 500
// slots from the full 152,203-property population) is a bigger operation
// you should trigger deliberately, not on every tick.

export async function POST(request: NextRequest) {
  const authError = requireApiKey(request);
  if (authError) return authError;

  const baseUrl = request.nextUrl.origin;
  const headers = {
    "Content-Type": "application/json",
    "x-api-key": request.headers.get("x-api-key") ?? "",
  };

  const generate = await fetch(`${baseUrl}/api/apex/tasks/generate`, {
    method: "POST",
    headers,
    body: JSON.stringify({ limit_slots: 500 }),
  });
  const generateResult = await generate.json();

  const worker = await fetch(`${baseUrl}/api/apex/worker`, {
    method: "POST",
    headers,
    body: JSON.stringify({ batch_size: 50 }),
  });
  const workerResult = await worker.json();

  const cycle = await fetch(`${baseUrl}/api/apex/cycle`, {
    method: "POST",
    headers,
    body: JSON.stringify({ window_minutes: 30 }),
  });
  const cycleResult = await cycle.json();

  return NextResponse.json({
    generate: generateResult,
    worker: workerResult,
    cycle: cycleResult,
  });
}
