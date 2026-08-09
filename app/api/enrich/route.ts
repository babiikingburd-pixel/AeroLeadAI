import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/utils/supabase/server";
import { requireApiKey, corsHeaders } from "@/lib/auth";

// Free-evidence enrichment (NWS storm data + permit validation).
// Auth-gated for the same reason as score-property.

export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(request.headers.get("origin")) });
}

export async function POST(request: NextRequest) {
  const authError = requireApiKey(request);
  if (authError) return authError;

  const body = await request.json().catch(() => null);
  if (!body?.county) {
    return NextResponse.json({ error: "county is required" }, { status: 400 });
  }

  const nwsRes = await fetch(
    `https://api.weather.gov/alerts/active?area=MN`,
    { headers: { "User-Agent": "AeroLeadAI (contact@aeroleadai.com)" } }
  );

  if (!nwsRes.ok) {
    return NextResponse.json({ error: "NWS lookup failed" }, { status: 502 });
  }

  const nwsData = await nwsRes.json();
  const supabase = createServiceClient();

  const { error: insertError } = await supabase.from("storm_evidence").insert({
    county: body.county,
    source: "NWS",
    fetched_at: new Date().toISOString(),
    alert_count: nwsData.features?.length ?? 0,
  });

  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  return NextResponse.json(
    { county: body.county, alerts_recorded: nwsData.features?.length ?? 0 },
    { headers: corsHeaders(request.headers.get("origin")) }
  );
}
