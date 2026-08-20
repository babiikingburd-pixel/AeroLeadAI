import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/utils/supabase/server";
import { refreshLiteLeaderboard } from "@/lib/lite/scoreRefresh.mjs";

export const dynamic = "force-dynamic";

const LEADERBOARD_LIMIT = 500;
const STABILITY_CYCLES = 2;

// Vercel Cron sends GET requests with CRON_SECRET in the bearer token.
// Fail closed when either the secret or the expected header is absent.
function authorized(request: NextRequest): boolean {
  const expected = process.env.CRON_SECRET;

  if (!expected) {
    return false;
  }

  return request.headers.get("authorization") === `Bearer ${expected}`;
}

function buildCycleId(): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `cron-${stamp}`;
}

export async function GET(request: NextRequest) {
  const started = Date.now();

  if (!authorized(request)) {
    return NextResponse.json(
      {
        ok: false,
        error: "unauthorized"
      },
      { status: 401 }
    );
  }

  const cycleId = buildCycleId();

  try {
    const supabase = createServiceClient();
    let data;
    let engine = "lite_evidence_twin";

    try {
      // The V23 GateKeeper control-plane ideas now run before slot assignment:
      // contradiction-first evidence, independent sources, reproducibility,
      // and opportunity/confidence/value kept as separate scores.
      data = await refreshLiteLeaderboard(supabase, { scanLimit: 1500 });
    } catch (liteError) {
      // Safe rollout path for a deployment that lands moments before its
      // matching migration. The legacy function remains service-role-only and
      // keeps the Top 500 alive; the response clearly reports the fallback.
      console.warn("Lite evidence-twin refresh unavailable; using APEX10 fallback", {
        cycleId,
        error: liteError instanceof Error ? liteError.message : String(liteError)
      });
      engine = "apex10_rebuild_leaderboard_fallback";
      const fallback = await supabase.rpc("apex10_rebuild_leaderboard", {
        p_cycle_id: cycleId,
        p_limit: LEADERBOARD_LIMIT,
        p_stability_cycles: STABILITY_CYCLES
      });
      if (fallback.error) throw fallback.error;
      data = {
        fallback: fallback.data,
        lite_error: liteError instanceof Error ? liteError.message : String(liteError)
      };
    }

    const durationMs = Date.now() - started;

    console.log("APEX leaderboard cron completed", {
      cycleId,
      durationMs,
      result: data
    });

    return NextResponse.json({
      ok: true,
      engine,
      cycle_id: cycleId,
      duration_ms: durationMs,
      result: data
    });
  } catch (error) {
    const durationMs = Date.now() - started;
    const message =
      error instanceof Error ? error.message : "Unexpected leaderboard error";

    console.error("APEX leaderboard cron crashed", {
      cycleId,
      error,
      durationMs
    });

    return NextResponse.json(
      {
        ok: false,
        cycle_id: cycleId,
        error: message,
        duration_ms: durationMs
      },
      { status: 500 }
    );
  }
}
