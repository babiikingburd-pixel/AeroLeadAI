export const maxDuration = 120;

// HOURLY DEEP-DIVE CYCLE
//
// Chains the two pieces that already existed but nothing ever called on a
// schedule: gap-router (find leads with no permit/value/image on file and
// enqueue the highest-ROI gap) -> priority-worker (actually run the real
// permit lookup, rescore, and pull imagery for whatever's queued).
//
// Without this, gap-router and priority-worker only ever ran when someone
// hit them by hand — the "gets smarter by the hour" loop never existed as
// anything but code sitting unused. This is the wiring, not new logic.
function auth(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  return req.headers.get("authorization") === `Bearer ${secret}` || new URL(req.url).searchParams.get("secret") === secret;
}

export async function POST(req) {
  if (!auth(req)) return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const origin = new URL(req.url).origin;
  const headers = { "Content-Type": "application/json", ...(process.env.CRON_SECRET ? { Authorization: `Bearer ${process.env.CRON_SECRET}` } : {}) };
  const cycleStarted = new Date().toISOString();

  const call = async (path, body) => {
    const res = await fetch(`${origin}${path}`, { method: "POST", headers, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }));
    return { status: res.status, data };
  };

  // 1. Route: find leads whose permit/value/image status is unknown or stale,
  //    rank by ROI, enqueue the highest-value gap per lead.
  const routed = await call("/api/enrich/gap-router", { limit: 1000, commit: true });

  // 2. Drain: actually run the real permit lookups (+ rescoring, + imagery
  //    for survivors) on whatever's sitting in the queue right now.
  const worked = await call("/api/enrich/priority-worker", { limit: 40 });

  return Response.json({
    ok: true,
    cycleStarted,
    routed,
    worked,
    cycleFinished: new Date().toISOString(),
    note: "Runs hourly via vercel.json cron. routed = leads newly enqueued this cycle; worked = leads actually permit-checked/rescored/imaged this cycle.",
  });
}

export async function GET(req) { return POST(req); }
