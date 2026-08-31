import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { SupabaseEvidenceCache } from "@/lib/oversight/cache";
import { makeEvidence } from "@/lib/oversight/evidence";
import { evaluateEvidence } from "@/lib/oversight/gatekeeper";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const BATCH_SIZE = 5;
const SHOVELS_DOCS = "https://www.shovels.ai/solutions/api";

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function clean(value: unknown) {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

async function consumeToken(db: any, rawToken: string | null) {
  if (!rawToken || !/^[a-f0-9]{64}$/i.test(rawToken)) return false;
  const tokenHash = hash(rawToken);
  const now = new Date().toISOString();
  const { data: token, error } = await db.from("oversight_pulse_tokens")
    .select("token_hash,expires_at,used_at")
    .eq("token_hash", tokenHash)
    .is("used_at", null)
    .gt("expires_at", now)
    .maybeSingle();
  if (error || !token) return false;
  const { data: consumed, error: consumeError } = await db.from("oversight_pulse_tokens")
    .update({ used_at: now })
    .eq("token_hash", tokenHash)
    .is("used_at", null)
    .select("token_hash")
    .maybeSingle();
  return !consumeError && Boolean(consumed);
}

async function shovelsLookup(address: string, apiKey: string) {
  const headers = { "X-API-Key": apiKey, accept: "application/json" };
  const search = await fetch(`https://api.shovels.ai/v2/addresses/search?q=${encodeURIComponent(address)}`, { headers, signal: AbortSignal.timeout(12000), cache: "no-store" });
  if (!search.ok) throw new Error(`shovels_address_http_${search.status}`);
  const searchBody = await search.json();
  const match = Array.isArray(searchBody) ? searchBody[0] : searchBody?.items?.[0] || searchBody?.results?.[0];
  const geoId = match?.geo_id || match?.id || match?.address_id;
  if (!geoId) return [];
  const permits = await fetch(`https://api.shovels.ai/v2/permits/search?geo_id=${encodeURIComponent(geoId)}&permit_tags=roofing`, { headers, signal: AbortSignal.timeout(12000), cache: "no-store" });
  if (!permits.ok) throw new Error(`shovels_permits_http_${permits.status}`);
  const permitBody = await permits.json();
  return Array.isArray(permitBody) ? permitBody : permitBody?.items || permitBody?.results || [];
}

async function recalculate(db: any, parcelId: string) {
  const cache = new SupabaseEvidenceCache(db);
  const evidence = await cache.list(parcelId);
  const decision = evaluateEvidence(evidence);
  const { data: profile, error: profileReadError } = await db.from("roof_profiles").select("address,zip").eq("parcel_id", parcelId).maybeSingle();
  if (profileReadError || !profile) throw new Error(profileReadError?.message || "profile_not_found");
  const { error } = await db.from("roof_profiles").update({
    state: decision.state,
    gate_allowed: decision.allowed,
    gate_reasons: decision.reasons,
    opportunity: decision.opportunity,
    evidence_confidence: decision.evidenceConfidence,
    commercial_priority: decision.commercialPriority,
    contradictions: decision.contradictions,
    corroborations: decision.corroborations,
    completion_pct: decision.completionPct,
    deep_dive_tier: decision.deepDiveTier,
    updated_at: new Date().toISOString(),
  }).eq("parcel_id", parcelId);
  if (error) throw error;
  if (decision.allowed) {
    const { error: publishError } = await db.from("published_summary").upsert({
      parcel_id: parcelId,
      address: profile.address,
      opportunity: decision.opportunity,
      evidence_confidence: decision.evidenceConfidence,
      commercial_priority: decision.commercialPriority,
      deep_dive_tier: decision.deepDiveTier,
      completion_pct: decision.completionPct,
      updated_at: new Date().toISOString(),
    }, { onConflict: "parcel_id" });
    if (publishError) throw publishError;
  } else {
    await db.from("published_summary").delete().eq("parcel_id", parcelId);
  }
  return decision;
}

export async function POST(request: NextRequest) {
  const db = supabaseServer();
  if (!db) return NextResponse.json({ ok: false, error: "supabase_not_configured" }, { status: 503 });
  if (!await consumeToken(db, request.headers.get("x-oversight-pulse-token"))) {
    return NextResponse.json({ ok: false, error: "invalid_or_expired_pulse_token" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const imageryParcelIds = Array.isArray(body?.parcelIds) ? body.parcelIds.filter((id: unknown) => typeof id === "string").slice(0, 20) : [];
  const permitApiKey = process.env.PERMIT_API_KEY || "";
  const { data: profiles, error: profileError } = await db.from("roof_profiles")
    .select("parcel_id,address,commercial_priority")
    .order("commercial_priority", { ascending: false })
    .limit(500);
  if (profileError) return NextResponse.json({ ok: false, error: profileError.message }, { status: 500 });
  const ids = (profiles || []).map((profile: any) => profile.parcel_id);
  const { data: evidence, error: evidenceError } = ids.length ? await db.from("evidence_records")
    .select("parcel_id,type,reality,payload,captured_at")
    .in("parcel_id", ids)
    .in("type", ["STRUCTURE", "PERMIT"])
    .order("captured_at", { ascending: false })
    .limit(3000) : { data: [], error: null };
  if (evidenceError) return NextResponse.json({ ok: false, error: evidenceError.message }, { status: 500 });

  const hasPermit = new Set((evidence || []).filter((row: any) => row.type === "PERMIT" && ["REAL_NOW", "CACHED_REAL"].includes(row.reality)).map((row: any) => row.parcel_id));
  const structure = new Map<string, any>();
  for (const row of evidence || []) if (row.type === "STRUCTURE" && !structure.has(row.parcel_id)) structure.set(row.parcel_id, row.payload || {});
  const preferred = new Map((profiles || []).map((profile: any) => [profile.parcel_id, profile]));
  const ordered = [
    ...imageryParcelIds.map((id: string) => preferred.get(id)).filter(Boolean),
    ...(profiles || []),
  ];
  const candidates: any[] = [];
  const seen = new Set<string>();
  for (const profile of ordered) {
    if (!profile || seen.has(profile.parcel_id) || hasPermit.has(profile.parcel_id)) continue;
    seen.add(profile.parcel_id);
    candidates.push(profile);
    if (candidates.length >= BATCH_SIZE) break;
  }

  const cache = new SupabaseEvidenceCache(db);
  const results: any[] = [];
  if (permitApiKey) {
    for (const profile of candidates) {
      const source = structure.get(profile.parcel_id) || {};
      const fullAddress = [profile.address, clean(source.city), "MN", clean(source.zip)].filter(Boolean).join(", ");
      try {
        const permits = await shovelsLookup(fullAddress, permitApiKey);
        if (permits.length) {
          await cache.persist(permits.slice(0, 100).map((permit: any) => makeEvidence({
            parcelId: profile.parcel_id,
            type: "PERMIT",
            provider: "shovels_permit_search",
            reality: "REAL_NOW",
            confidence: 0.9,
            effectiveAt: permit.file_date || permit.issue_date || permit.date || undefined,
            sourceRef: permit.jurisdiction_permit_url || SHOVELS_DOCS,
            payload: permit,
          })));
        } else {
          await cache.persist([makeEvidence({
            parcelId: profile.parcel_id,
            type: "PERMIT",
            provider: "shovels_permit_search",
            reality: "REAL_NOW",
            confidence: 0.85,
            sourceRef: SHOVELS_DOCS,
            payload: { records: [], search_result: "no_matching_roofing_permits", searched_address: fullAddress, searched_at: new Date().toISOString() },
          })]);
        }
        const decision = await recalculate(db, profile.parcel_id);
        results.push({ parcelId: profile.parcel_id, permits: permits.length, state: decision.state });
      } catch (error) {
        results.push({ parcelId: profile.parcel_id, error: error instanceof Error ? error.message : "permit_search_failed" });
      }
    }
  }

  const recalculated = [];
  for (const parcelId of imageryParcelIds) {
    try {
      const decision = await recalculate(db, parcelId);
      recalculated.push({ parcelId, state: decision.state, completionPct: decision.completionPct });
    } catch (error) {
      recalculated.push({ parcelId, error: error instanceof Error ? error.message : "recalculation_failed" });
    }
  }
  await db.from("oversight_pulse_tokens").delete().lt("expires_at", new Date(Date.now() - 86400000).toISOString());
  return NextResponse.json({
    ok: true,
    providerConfigured: Boolean(permitApiKey),
    permitCandidates: candidates.length,
    permitResults: results,
    imageryProfilesRecalculated: recalculated,
  });
}
