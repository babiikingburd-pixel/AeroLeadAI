import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/utils/supabase/server";

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
    // The checked-in SQL function defaults to 500 and 2 only when arguments
    // are omitted. Supabase RPC sends named arguments, so pass the values
    // explicitly; sending null would disable the qualification comparisons.
    const supabase = createServiceClient();
    const { data, error } = await supabase.rpc("apex10_rebuild_leaderboard", {
      p_cycle_id: cycleId,
      p_limit: LEADERBOARD_LIMIT,
      p_stability_cycles: STABILITY_CYCLES
    });

    const durationMs = Date.now() - started;

    if (error) {
      console.error("APEX leaderboard cron failed", {
        cycleId,
        error,
        durationMs
      });

      return NextResponse.json(
        {
          ok: false,
          cycle_id: cycleId,
          error: error.message,
          duration_ms: durationMs
        },
        { status: 500 }
      );
    }

    console.log("APEX leaderboard cron completed", {
      cycleId,
      durationMs,
      result: data
    });

    return NextResponse.json({
      ok: true,
      engine: "apex10_rebuild_leaderboard",
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
