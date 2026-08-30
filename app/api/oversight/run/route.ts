import { NextRequest, NextResponse } from "next/server";
import { requireApiKey, corsHeaders } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabaseServer";
import { createEvidenceProviders } from "@/lib/oversight/providers";
import { OversightPipeline } from "@/lib/oversight/pipeline";

export const dynamic = "force-dynamic";
export async function POST(request: NextRequest) {
  const authError = requireApiKey(request); if (authError) return authError;
  const body = await request.json().catch(() => null);
  if (!body?.parcelId || !body?.address) return NextResponse.json({ error: "parcelId and address are required" }, { status: 400 });
  const db = supabaseServer();
  if (!db) return NextResponse.json({ error: "Supabase server connection is not configured" }, { status: 503 });
  try {
    const result = await new OversightPipeline(db, createEvidenceProviders()).run(body);
    return NextResponse.json({ ok: true, ...result }, { headers: corsHeaders(request.headers.get("origin")) });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "pipeline_failed" }, { status: 500 });
  }
}
