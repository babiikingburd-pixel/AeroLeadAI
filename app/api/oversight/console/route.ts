import { NextRequest, NextResponse } from "next/server";
import { requireApiKey } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabaseServer";
import { loadOversightConsoleData } from "@/lib/oversight/consoleData";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  const authError = requireApiKey(request); if (authError) return authError;
  const db = supabaseServer(); if (!db) return NextResponse.json({ error: "not_configured" }, { status: 503 });
  const result = await loadOversightConsoleData(db);
  if (result.connectionError) return NextResponse.json({ error: result.connectionError }, { status: 500 });
  const evidence = result.evidence.map((row: any) => row.payload?.image_url
    ? { ...row, payload: { ...row.payload, image_url: new URL(row.payload.image_url, request.url).toString() } }
    : row);
  return NextResponse.json({ ...result, evidence });
}
