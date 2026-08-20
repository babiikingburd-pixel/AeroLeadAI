import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/utils/supabase/server";
import { requireApiKey, corsHeaders } from "@/lib/auth";
export const dynamic = "force-dynamic";

// APEX 20.4 scoring endpoint. Auth-gated per 04-SECURITY-NOTES.md:
// "Add an API key/auth header before deploying anywhere reachable
// from the internet." This route is the enforcement point.

export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(request.headers.get("origin")) });
}

export async function POST(request: NextRequest) {
  const authError = requireApiKey(request);
  if (authError) return authError;

  const body = await request.json().catch(() => null);
  if (!body?.property_id) {
    return NextResponse.json({ error: "property_id is required" }, { status: 400 });
  }

  const supabase = createServiceClient();

  const { data: property, error } = await supabase
    .from("batch_leads")
    .select("*")
    .eq("id", body.property_id)
    .single();

  if (error || !property) {
    return NextResponse.json({ error: "Property not found" }, { status: 404 });
  }

  // APEX scoring signals — real fields from live data, no placeholders.
  const currentYear = new Date().getFullYear();
  const age = property.year_built ? currentYear - property.year_built : null;
  const ageScore = age ? Math.min(40, Math.round((age / 40) * 40)) : 0;
  const stormScore = property.storm_events_5yr ? Math.min(30, property.storm_events_5yr * 6) : 0;
  const permitPenalty = property.recent_roof_permit ? -50 : 0;

  const apexScore = Math.max(0, Math.min(100, ageScore + stormScore + permitPenalty + 30));

  return NextResponse.json(
    {
      property_id: property.id,
      address: property.address,
      apex_score: apexScore,
      signals: { age, ageScore, stormScore, permitPenalty },
      engine_version: "APEX 20.4",
    },
    { headers: corsHeaders(request.headers.get("origin")) }
  );
}
