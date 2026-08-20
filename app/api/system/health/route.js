import { supabaseServer } from "../../../../lib/supabaseServer";
import { resolveSupabaseServerConfig } from "../../../../lib/supabaseEnvironment";

export const dynamic = "force-dynamic";

export async function GET() {
  const checks = {
    supabaseConfigured: false,
    imageBucketConfigured: false,
    mapboxConfigured: false,
    googleConfigured: false,
    cronProtected: !!process.env.CRON_SECRET,
  };

  const supabase = supabaseServer();
  checks.supabaseConfigured = !!supabase;
  checks.imageBucketConfigured = resolveSupabaseServerConfig().configured;
  checks.mapboxConfigured = !!(process.env.MAPBOX_TOKEN || process.env.NEXT_PUBLIC_MAPBOX_TOKEN);
  checks.googleConfigured = !!process.env.GOOGLE_MAPS_API_KEY;

  let dbOk = false;
  if (supabase) {
    try {
      const { error } = await supabase.from("batch_leads").select("id").limit(1);
      dbOk = !error;
    } catch {}
  }

  const ready = checks.supabaseConfigured && dbOk;
  return Response.json({
    ok: ready,
    status: ready ? "ready" : "degraded",
    checks: { ...checks, databaseReachable: dbOk },
    note: "No secret values are returned."
  }, { status: ready ? 200 : 503 });
}
