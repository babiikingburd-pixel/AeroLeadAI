export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  return req.headers.get("authorization") === `Bearer ${secret}` ||
    new URL(req.url).searchParams.get("secret") === secret;
}

async function postJson(origin, path, body, secret) {
  const headers = { "content-type": "application/json" };
  if (secret) headers.authorization = `Bearer ${secret}`;
  try {
    const res = await fetch(`${origin}${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(55000),
      cache: "no-store",
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok && data.ok !== false, status: res.status, data };
  } catch (error) {
    return { ok: false, status: 0, data: { error: error.message } };
  }
}

export async function GET(req) {
  if (!authorized(req)) {
    return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const origin = new URL(req.url).origin;
  const secret = process.env.CRON_SECRET || "";
  const stamp = Date.now();

  // Run several bounded workers in parallel. Each Top-500 worker claims its
  // own tasks with SKIP LOCKED, so they cannot process the same task twice.
  // The validation worker is the source of truth for assessor/year-built,
  // value, permit validation and imagery enrichment.
  const [top500Cycle, top500WorkerA, top500WorkerB, validation] = await Promise.all([
    postJson(origin, "/api/twincities/top500-network", {
      mode: "cycle",
      limit: 2,
      workerId: `pulse-cycle-${stamp}`,
    }, secret),
    postJson(origin, "/api/twincities/top500-network", {
      mode: "work",
      limit: 2,
      workerId: `pulse-a-${stamp}`,
    }, secret),
    postJson(origin, "/api/twincities/top500-network", {
      mode: "work",
      limit: 2,
      workerId: `pulse-b-${stamp}`,
    }, secret),
    postJson(origin, "/api/twincities/validation-worker", {
      limit: 12,
      workerId: `pulse-validator-${stamp}`,
    }, secret),
  ]);

  const calls = { top500Cycle, top500WorkerA, top500WorkerB, validation };
  const okCount = Object.values(calls).filter(x => x.ok).length;

  return Response.json({
    ok: okCount >= 2,
    version: "GATEKEEPER-NETWORK-PULSE-1",
    ranAt: new Date().toISOString(),
    successfulWorkers: okCount,
    totalWorkers: 4,
    calls,
  }, { status: okCount >= 2 ? 200 : 503 });
}
