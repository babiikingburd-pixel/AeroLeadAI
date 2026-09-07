import { supabaseServer } from "../../../../lib/supabaseServer";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(req) {
  const expected = process.env.CRON_SECRET;
  const origin = req.headers.get("origin");
  const host = req.headers.get("host");

  if (origin && host) {
    try {
      if (new URL(origin).host === host) return true;
    } catch {}
  }

  return Boolean(expected) && req.headers.get("authorization") === `Bearer ${expected}`;
}

export async function POST(req) {
  if (!authorized(req)) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const db = supabaseServer();
  if (!db) {
    return Response.json({ ok: false, error: "Supabase not configured." }, { status: 503 });
  }

  const refreshed = await db.rpc("refresh_oversight_leaderboard");
  if (refreshed.error) {
    return Response.json({ ok: false, error: refreshed.error.message }, { status: 500 });
  }

  const [profiles, ranked, imagery, pulse] = await Promise.all([
    db.from("roof_profiles").select("parcel_id", { count: "exact", head: true }),
    db.from("roof_profiles").select("parcel_id", { count: "exact", head: true }).eq("leaderboard_eligible", true),
    db.from("evidence_records")
      .select("parcel_id")
      .eq("type", "IMAGERY")
      .in("reality", ["REAL_NOW", "CACHED_REAL"])
      .not("payload->>storage_path", "is", null)
      .neq("payload->>storage_path", "")
      .limit(5000),
    db.from("oversight_pulse_state")
      .select("last_finished_at,last_result")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const error = profiles.error || ranked.error || imagery.error || pulse.error;
  if (error) {
    return Response.json({ ok: false, error: error.message }, { status: 500 });
  }

  const photoCount = new Set((imagery.data || []).map((row) => row.parcel_id)).size;
  return Response.json({
    ok: true,
    mode: "oversight_collection",
    gatekeeper: "BYPASSED_FOR_COLLECTION",
    profiles: profiles.count || 0,
    ranked: ranked.count || 0,
    images: photoCount,
    pulseLastFinishedAt: pulse.data?.last_finished_at || null,
    pulseLastResult: pulse.data?.last_result || null,
    note: "Collection leads synchronized. Automatic evidence and discovery workers continue independently.",
  });
}
