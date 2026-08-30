import { NextRequest, NextResponse } from "next/server";
import { requireApiKey } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabaseServer";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  const authError = requireApiKey(request); if (authError) return authError;
  const db = supabaseServer(); if (!db) return NextResponse.json({ error: "not_configured" }, { status: 503 });
  const [profiles, evidence, rings] = await Promise.all([
    db.from("roof_profiles").select("*").order("commercial_priority", { ascending: false }).limit(500),
    db.from("evidence_records").select("type,reality,captured_at"),
    db.from("ring_status").select("*").order("ring_id"),
  ]);
  const error = profiles.error || evidence.error || rings.error;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ profiles: profiles.data || [], evidence: evidence.data || [], rings: rings.data || [] });
}
