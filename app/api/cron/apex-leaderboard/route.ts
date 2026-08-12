import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/utils/supabase/server";

export const dynamic = "force-dynamic";

// Vercel Cron always sends GET requests with an Authorization: Bearer
// header carrying CRON_SECRET. Reject anything else outright.
function authorized(request: NextRequest): boolean {
  const expected = process.env.CRON_SECRET;

  if (!expected) {
    return false;
  }

  const auth = request.headers.get("authorization");

  return auth === `Bearer ${expected}`;
}

// apex10_rebuild_leaderboard(p_cycle_id text, p_limit int DEFAULT NULL,
// p_stability_cycles int DEFAULT NULL) RETURNS jsonb
// (supabase/migrations/20260805b_apex100_global_rank_corrected.sql)
//
// p_cycle_id has NO default -- it is a required argument, so every
// invocation needs a fresh, unique value (cycle_id is UNIQUE on
// twincities_apex_cycles). Return type is a scalar jsonb object, not a
// table/set, so supabase-js's .rpc() returns it directly in `data`.
// Only the `service_role` grantee has EXECUTE -- anon/authenticated are
// both revoked, so createServiceClient() (service role key) is mandatory.
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

  const supabase = createServiceClient();
  const cycleId = buildCycleId();

  // p_limit and p_stability_cycles are left null on purpose so the
  // function falls back to twincities_apex_controls (top_n=500,
  // stability_cycles=2) rather than this endpoint silently overriding
  // governance thresholds set elsewhere.
  const { data, error } = await supabase.rpc("apex10_rebuild_leaderboard", {
    p_cycle_id: cycleId,
    p_limit: null,
    p_stability_cycles: null
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

  // data is the raw jsonb object the function returns, e.g.
  // { ok, changed, promoted, demoted, top500, promotionBudgetRemaining }
  // or { ok: false, skipped: true, reason: ... } if governance is
  // disabled via twincities_apex_controls.enabled.
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
}
