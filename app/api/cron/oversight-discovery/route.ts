import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { runSouthernFrontDiscovery } from "@/lib/oversight/southernFront";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function cronAuthorized(request: NextRequest) {
  const expected = process.env.CRON_SECRET;
  return Boolean(expected) && request.headers.get("authorization") === `Bearer ${expected}`;
}

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

async function consumePulseToken(db: any, rawToken: string | null) {
  if (!rawToken || !/^[a-f0-9]{64}$/i.test(rawToken)) return false;
  const tokenHash = hash(rawToken);
  const now = new Date().toISOString();
  const { data: token, error } = await db.from("oversight_pulse_tokens")
    .select("token_hash,expires_at,used_at")
    .eq("token_hash", tokenHash)
    .is("used_at", null)
    .gt("expires_at", now)
    .maybeSingle();
  if (error || !token) return false;
  const { data: consumed, error: consumeError } = await db.from("oversight_pulse_tokens")
    .update({ used_at: now })
    .eq("token_hash", tokenHash)
    .is("used_at", null)
    .select("token_hash")
    .maybeSingle();
  return !consumeError && Boolean(consumed);
}

export async function GET(request: NextRequest) {
  const db = supabaseServer();
  if (!db) return NextResponse.json({ ok: false, error: "supabase_not_configured" }, { status: 503 });
  const authorized = cronAuthorized(request) || await consumePulseToken(db, request.headers.get("x-oversight-pulse-token"));
  if (!authorized) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  try {
    // Hourly discovery is intentionally bounded: four fresh parcels per city,
    // with every imported parcel sent through Census identity verification.
    // This increases intake without dumping avoidable identity repairs on Doctor.
    const result = await runSouthernFrontDiscovery(db, { perCity: 4, censusPerCity: 4 });
    return NextResponse.json({
      ok: true,
      cadence: "hourly",
      maxNewPerRun: 12,
      identityVerification: "census_all_selected",
      ...result,
    });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "discovery_failed" }, { status: 500 });
  }
}
