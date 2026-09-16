import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const MESSAGE = "PR 39 is not the production imagery path. Use PR 38 /api/imagery-agent, which fetches imagery server-side and never returns API keys.";

export async function GET() {
  return NextResponse.json({ ok: false, error: MESSAGE }, { status: 409 });
}

export async function POST() {
  return NextResponse.json({ ok: false, error: MESSAGE }, { status: 409 });
}
