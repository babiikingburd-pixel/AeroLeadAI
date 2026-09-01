import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { runSouthernFrontDiscovery } from "@/lib/oversight/southernFront";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function authorized(request: NextRequest) {
  const expected = process.env.CRON_SECRET;
  return Boolean(expected) && request.headers.get("authorization") === `Bearer ${expected}`;
}

export async function GET(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const db = supabaseServer();
  if (!db) return NextResponse.json({ ok: false, error: "supabase_not_configured" }, { status: 503 });
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
