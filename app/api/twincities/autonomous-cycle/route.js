import { supabaseServer } from "../../../../lib/supabaseServer";
export const dynamic = "force-dynamic";

export const maxDuration = 60;

function auth(req) {
  const secret = process.env.CRON_SECRET;
  const origin = req.headers.get("origin") || "";
  const host = req.headers.get("host") || "";
  if (host && origin && origin.includes(host)) return true;
  if (!secret) return true;
  return req.headers.get("authorization") === `Bearer ${secret}` || new URL(req.url).searchParams.get("secret") === secret;
}

export async function POST(req) {
  if (!auth(req)) return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const supabase = supabaseServer();
  if (!supabase) return Response.json({ ok: false, error: "Supabase not configured." }, { status: 500 });
  const origin = new URL(req.url).origin;
  const headers = { "Content-Type": "application/json", ...(process.env.CRON_SECRET ? { Authorization: `Bearer ${process.env.CRON_SECRET}` } : {}) };
  const cycleStarted = new Date().toISOString();

  const cycle = async (path, body) => {
    const res = await fetch(`${origin}${path}`, { method: "POST", headers, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }));
    return { status: res.status, data };
  };

  const scoring = await cycle("/api/twincities/fast-cycle", { scanLimit: 1000, challengerLimit: 750 });
  const validation = await cycle("/api/twincities/validation-worker", { limit: 12 });

  // APEX 14.2: use the full serverless work slice every cycle. The dashboard
  // heartbeat can invoke this same-origin, while CRON_SECRET still protects
  // external callers. Each claimed task is atomic in Supabase.
  const top500Network = await cycle("/api/twincities/top500-network", {
    mode: "cycle",
    limit: 12,
    workerId: `cycle-${Date.now()}`
  });

  const { data: top } = await supabase.from("batch_leads")
    .select("id,priority_score,confidence_score,validation_status")
    .in("county", ["hennepin","ramsey","dakota","scott","carver","anoka"])
    .eq("sales_status", "new").neq("review_status", "rejected")
    .order("priority_score", { ascending: false }).limit(600);

  return Response.json({
    ok: true,
    version: "APEX14.2",
    cycleStarted,
    scoring,
    validation,
    top500Network,
    currentTop500: Math.min(top?.length || 0, 500),
    currentTop600: top?.length || 0,
    cutoffScore500: top?.[499]?.priority_score ?? null,
    cutoffScore600: top?.[599]?.priority_score ?? null,
    cycleFinished: new Date().toISOString()
  });
}

export async function GET(req) { return POST(req); }
