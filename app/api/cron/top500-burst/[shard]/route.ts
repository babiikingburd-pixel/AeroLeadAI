import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const VALID_SHARDS = new Set(Array.from({ length: 24 }, (_, index) => String(index)));

function authorized(request: NextRequest): boolean {
  const expected = process.env.CRON_SECRET;
  return Boolean(expected) && request.headers.get("authorization") === `Bearer ${expected}`;
}

export async function GET(
  request: NextRequest,
  { params }: { params: { shard: string } }
) {
  if (!authorized(request)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  if (!VALID_SHARDS.has(params.shard)) {
    return NextResponse.json({ ok: false, error: "unknown shard" }, { status: 404 });
  }

  const authorization = request.headers.get("authorization") as string;
  const response = await fetch(`${request.nextUrl.origin}/api/twincities/top500-network`, {
    method: "POST",
    headers: {
      authorization,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      mode: "work",
      laneName: "imagery",
      limit: 8,
      workerId: `hobby-imagery-${params.shard}-${Date.now()}`,
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(55_000),
  });
  const result = await response.json().catch(() => ({}));

  return NextResponse.json(
    {
      ok: response.ok && result.ok !== false,
      shard: params.shard,
      worker: result,
    },
    { status: response.ok && result.ok !== false ? 200 : 502 }
  );
}
