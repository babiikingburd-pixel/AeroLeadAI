import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

export const dynamic = "force-dynamic";

function authorized(request: NextRequest): boolean {
  const expected = process.env.CRON_SECRET;
  return Boolean(expected) && request.headers.get("authorization") === `Bearer ${expected}`;
}

function buildCycleId(): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `cron-${stamp}`;
}

export async function GET(request: NextRequest) {
  const started = Date.now();
  const cycleId = buildCycleId();

  if (!authorized(request)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const db = supabaseServer();
  if (!db) {
    return NextResponse.json({ ok: false, cycle_id: cycleId, error: "supabase_not_configured" }, { status: 503 });
  }

  try {
    const refresh = await db.rpc("refresh_oversight_leaderboard");
    if (refresh.error) throw refresh.error;

    const [profiles, ranked] = await Promise.all([
      db.from("roof_profiles").select("parcel_id", { count: "exact", head: true }),
      db.from("roof_profiles").select("parcel_id", { count: "exact", head: true }).eq("leaderboard_eligible", true),
    ]);
    const countError = profiles.error || ranked.error;
    if (countError) throw countError;

    const durationMs = Date.now() - started;
    const result = {
      profiles: profiles.count || 0,
      ranked: ranked.count || 0,
      top100: Math.min(100, ranked.count || 0),
      top500: Math.min(500, ranked.count || 0),
      gatekeeper: "BYPASSED_FOR_COLLECTION",
    };

    console.log("Oversight collection leaderboard refreshed", { cycleId, durationMs, result });
    return NextResponse.json({
      ok: true,
      engine: "oversight_collection_leaderboard",
      cycle_id: cycleId,
      duration_ms: durationMs,
      result,
    });
  } catch (error) {
    const durationMs = Date.now() - started;
    const message = error instanceof Error ? error.message : "Unexpected leaderboard error";
    console.error("Oversight collection leaderboard cron crashed", { cycleId, error, durationMs });
    return NextResponse.json({ ok: false, cycle_id: cycleId, error: message, duration_ms: durationMs }, { status: 500 });
  }
}
