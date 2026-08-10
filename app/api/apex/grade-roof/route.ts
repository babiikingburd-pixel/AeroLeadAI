import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/utils/supabase/server";
import { requireApiKey } from "@/lib/auth";

// Fills the gap lib/apex/lanes.ts's imagery/damage/development lanes flag
// honestly ("requires imagery credentials"): /api/imagery-agent now has a
// free, keyless Esri fallback and /api/damage-agent runs real vision
// analysis once GROQ_API_KEY or ANTHROPIC_API_KEY is set, so this route
// wires the two together into an actual roof grade per property instead of
// leaving it as insufficient_data forever. Every outcome — success or
// failure — is written to apex_evidence_events (category "damage") so it
// feeds evidence_confidence/evidence_completeness in /api/apex/cycle the
// same way the worker's lane results do.

export const maxDuration = 300;

const MAX_PROPERTIES = 15;

type ServiceClient = ReturnType<typeof createServiceClient>;

interface GradeResult {
  property_id: string;
  status:
    | "graded"
    | "not_found"
    | "missing_coordinates"
    | "imagery_unavailable"
    | "vision_unavailable";
  roof_score?: number;
  level?: string;
  indicators?: string[];
  confidence?: string;
  notes?: string;
  provider?: string;
  reason?: string;
}

function confidenceToNumber(confidence: unknown): number {
  if (confidence === "high") return 85;
  if (confidence === "medium") return 65;
  if (confidence === "low") return 40;
  return 0;
}

async function writeEvidence(
  supabase: ServiceClient,
  propertyId: string,
  params: {
    claim: string;
    evidence: Record<string, unknown>;
    confidence: number;
    verification_status: "verified" | "insufficient_data";
  }
) {
  await supabase.from("apex_evidence_events").insert({
    property_id: propertyId,
    category: "damage",
    source: "apex-grade-roof",
    claim: params.claim,
    value: params.evidence,
    confidence: params.confidence,
    freshness: 100,
    verification_status: params.verification_status,
  });
}

export async function POST(request: NextRequest) {
  const authError = requireApiKey(request);
  if (authError) return authError;

  const body = await request.json().catch(() => ({}));
  const propertyIds = body?.property_ids;

  if (!Array.isArray(propertyIds) || propertyIds.length === 0) {
    return NextResponse.json(
      { error: "property_ids (non-empty array) is required" },
      { status: 400 }
    );
  }
  if (propertyIds.length > MAX_PROPERTIES) {
    return NextResponse.json(
      { error: `Max ${MAX_PROPERTIES} property_ids per request` },
      { status: 400 }
    );
  }
  if (!propertyIds.every((id) => typeof id === "string" && id.length > 0)) {
    return NextResponse.json(
      { error: "property_ids must be non-empty strings" },
      { status: 400 }
    );
  }

  const supabase = createServiceClient();
  const baseUrl = request.nextUrl.origin;
  const results: GradeResult[] = [];

  for (const propertyId of propertyIds as string[]) {
    const { data: lead, error: leadError } = await supabase
      .from("batch_leads")
      .select("id, address, lat, lon")
      .eq("id", propertyId)
      .single();

    if (leadError || !lead) {
      results.push({ property_id: propertyId, status: "not_found" });
      continue;
    }
    if (lead.lat == null || lead.lon == null) {
      results.push({ property_id: propertyId, status: "missing_coordinates" });
      continue;
    }

    const imageryRes = await fetch(`${baseUrl}/api/imagery-agent`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lat: lead.lat, lon: lead.lon, lite: true }),
    });
    const imagery = await imageryRes.json().catch(() => null);
    const angleEntries: [string, string][] = imagery && !imagery.error ? Object.entries(imagery.angles ?? {}) : [];

    if (angleEntries.length === 0) {
      const reason = imagery?.error ?? imagery?.notes ?? "No imagery available for these coordinates";
      await writeEvidence(supabase, propertyId, {
        claim: "damage_requires_imagery",
        evidence: { reason },
        confidence: 0,
        verification_status: "insufficient_data",
      });
      results.push({ property_id: propertyId, status: "imagery_unavailable", reason });
      continue;
    }

    const images = angleEntries.slice(0, 4).map(([label, dataUrl]) => {
      const match = /^data:([^;]+);base64,(.+)$/.exec(dataUrl);
      return match
        ? { label, mediaType: match[1], base64Image: match[2] }
        : { label, mediaType: "image/jpeg", base64Image: dataUrl };
    });

    const damageRes = await fetch(`${baseUrl}/api/damage-agent`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ domain: "roof", images, address: lead.address }),
    });
    const damage = await damageRes.json().catch(() => null);

    if (!damageRes.ok || !damage || typeof damage.concern_score !== "number") {
      const reason = damage?.error ?? "Vision provider not configured or analysis failed";
      await writeEvidence(supabase, propertyId, {
        claim: "damage_analysis_unavailable",
        evidence: { reason },
        confidence: 0,
        verification_status: "insufficient_data",
      });
      results.push({ property_id: propertyId, status: "vision_unavailable", reason });
      continue;
    }

    const roofScore = Math.max(0, Math.min(100, Math.round(damage.concern_score)));

    await supabase
      .from("batch_leads")
      .update({
        roof_score: roofScore,
        damage_notes: {
          roof: {
            indicators: damage.indicators,
            notes: damage.notes,
            confidence: damage.confidence,
            provider: damage.provider,
            graded_at: new Date().toISOString(),
          },
        },
        updated_at: new Date().toISOString(),
      })
      .eq("id", propertyId);

    await writeEvidence(supabase, propertyId, {
      claim: `roof_concern_${damage.level}`,
      evidence: {
        concern_score: roofScore,
        indicators: damage.indicators,
        notes: damage.notes,
        provider: damage.provider,
        imagery_provider: imagery.provider,
      },
      confidence: confidenceToNumber(damage.confidence),
      verification_status: damage.parse_error ? "insufficient_data" : "verified",
    });

    results.push({
      property_id: propertyId,
      status: "graded",
      roof_score: roofScore,
      level: damage.level,
      indicators: damage.indicators,
      confidence: damage.confidence,
      notes: damage.notes,
      provider: damage.provider,
    });
  }

  return NextResponse.json({
    graded: results.filter((r) => r.status === "graded").length,
    total: results.length,
    results,
  });
}
