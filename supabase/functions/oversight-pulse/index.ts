import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const PROJECT_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const APP_URL = "https://aero-lead-ai.vercel.app";
const IMAGE_BUCKET = "property-images";
const BATCH_SIZE = 5;
const CANDIDATE_POOL_SIZE = 100;

const db = createClient(PROJECT_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

function hex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256(value: string) {
  return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))));
}

function safe(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 120);
}

function coordinates(record: any) {
  const payload = record?.payload || {};
  const latitude = Number(payload.latitude ?? payload.lat);
  const longitude = Number(payload.longitude ?? payload.lon ?? payload.lng);
  return Number.isFinite(latitude) && Number.isFinite(longitude) && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180
    ? { latitude, longitude }
    : null;
}

function esriUrl(latitude: number, longitude: number) {
  const delta = 0.0008;
  const bbox = [longitude - delta, latitude - delta, longitude + delta, latitude + delta].join(",");
  return `https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export?bbox=${bbox}&bboxSR=4326&imageSR=3857&size=640,640&format=jpg&compressionQuality=82&f=image`;
}

async function imageCandidates() {
  const { data: tasks, error: taskError } = await db.from("oversight_audit_tasks")
    .select("parcel_id,priority")
    .eq("requirement", "imagery_capture")
    .eq("status", "READY")
    .lte("next_attempt_at", new Date().toISOString())
    .order("priority", { ascending: false })
    .order("updated_at", { ascending: true })
    .limit(CANDIDATE_POOL_SIZE);
  if (taskError) throw taskError;
  const taskIds = (tasks || []).map((row) => row.parcel_id);
  if (!taskIds.length) return [];
  const { data: profiles, error } = await db.from("roof_profiles")
    .select("parcel_id,address,commercial_priority,updated_at")
    .in("parcel_id", taskIds);
  if (error) throw error;
  const order = new Map(taskIds.map((id, index) => [id, index]));
  const orderedProfiles = [...(profiles || [])].sort((a, b) => (order.get(a.parcel_id) ?? 999) - (order.get(b.parcel_id) ?? 999));
  const ids = orderedProfiles.map((row) => row.parcel_id);
  if (!ids.length) return [];
  const { data: evidence, error: evidenceError } = await db.from("evidence_records")
    .select("parcel_id,type,reality,payload,captured_at")
    .in("parcel_id", ids)
    .in("type", ["STRUCTURE", "PROPERTY", "IMAGERY"])
    .in("reality", ["REAL_NOW", "CACHED_REAL"])
    .order("captured_at", { ascending: false })
    .limit(3000);
  if (evidenceError) throw evidenceError;
  const hasImage = new Set((evidence || []).filter((row) => row.type === "IMAGERY" && ["REAL_NOW", "CACHED_REAL"].includes(row.reality)).map((row) => row.parcel_id));
  const locationEvidence = new Map<string, any>();
  for (const row of evidence || []) {
    if (!["STRUCTURE", "PROPERTY"].includes(row.type) || !["REAL_NOW", "CACHED_REAL"].includes(row.reality)) continue;
    if (!locationEvidence.has(row.parcel_id) && coordinates(row)) locationEvidence.set(row.parcel_id, row);
  }
  return orderedProfiles
    .filter((profile) => !hasImage.has(profile.parcel_id) && coordinates(locationEvidence.get(profile.parcel_id)))
    .slice(0, BATCH_SIZE)
    .map((profile) => ({ ...profile, ...coordinates(locationEvidence.get(profile.parcel_id))! }));
}

async function storeImage(candidate: any) {
  const sourceUrl = esriUrl(candidate.latitude, candidate.longitude);
  const response = await fetch(sourceUrl, { headers: { "user-agent": "AeroLeadAI-Oversight-Pulse/1.0" }, signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`esri_http_${response.status}`);
  const contentType = response.headers.get("content-type") || "image/jpeg";
  if (!contentType.startsWith("image/")) throw new Error("esri_non_image_response");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length < 1000) throw new Error("esri_image_too_small");
  const contentHash = hex(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)));
  const storagePath = `oversight/${safe(candidate.parcel_id)}/overview-current.jpg`;
  const { error: uploadError } = await db.storage.from(IMAGE_BUCKET).upload(storagePath, bytes, { contentType, upsert: true, cacheControl: "86400" });
  if (uploadError) throw uploadError;
  const capturedAt = new Date().toISOString();
  const evidenceId = `imagery:${candidate.parcel_id}:${contentHash.slice(0, 24)}`;
  const { error: evidenceError } = await db.from("evidence_records").upsert({
    id: evidenceId,
    parcel_id: candidate.parcel_id,
    type: "IMAGERY",
    provider: "esri_world_imagery",
    reality: "REAL_NOW",
    captured_at: capturedAt,
    effective_at: null,
    source_ref: sourceUrl,
    content_hash: contentHash,
    confidence: 0.72,
    payload: {
      storage_path: storagePath,
      image_role: "current_satellite_overview",
      provider: "Esri World Imagery",
      latitude: candidate.latitude,
      longitude: candidate.longitude,
      byte_size: bytes.length,
      mime_type: contentType,
      capture_date: null,
      damage_analysis_status: "not_analyzed",
    },
  }, { onConflict: "id" });
  if (evidenceError) throw evidenceError;
  return candidate.parcel_id;
}

async function runPermitBridge(parcelIds: string[]) {
  const raw = crypto.getRandomValues(new Uint8Array(32));
  const token = hex(raw);
  const tokenHash = await sha256(token);
  const { error } = await db.from("oversight_pulse_tokens").insert({ token_hash: tokenHash, expires_at: new Date(Date.now() + 5 * 60_000).toISOString() });
  if (error) throw error;
  const response = await fetch(`${APP_URL}/api/oversight/pulse/permits`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-oversight-pulse-token": token },
    body: JSON.stringify({ parcelIds }),
    signal: AbortSignal.timeout(45_000),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`permit_bridge_http_${response.status}:${body?.error || "failed"}`);
  return body;
}

Deno.serve(async () => {
  const workerId = crypto.randomUUID();
  const { data: claimed, error: claimError } = await db.rpc("claim_oversight_pulse", { p_worker_id: workerId, p_lease_seconds: 240, p_min_interval_seconds: 240 });
  if (claimError) return Response.json({ ok: false, error: claimError.message }, { status: 500 });
  if (!claimed) return Response.json({ ok: true, skipped: "lease_or_interval" });

  const result: any = { imagery: { attempted: 0, completed: 0, failures: [] }, permits: null };
  try {
    const candidates = await imageCandidates();
    result.imagery.attempted = candidates.length;
    const settled = await Promise.allSettled(candidates.map(storeImage));
    const completedIds = settled.filter((item): item is PromiseFulfilledResult<string> => item.status === "fulfilled").map((item) => item.value);
    result.imagery.completed = completedIds.length;
    result.imagery.failures = settled.filter((item): item is PromiseRejectedResult => item.status === "rejected").map((item) => item.reason instanceof Error ? item.reason.message : String(item.reason));
    result.permits = await runPermitBridge(completedIds);
    result.evaluation = "BYPASSED";
    await db.rpc("finish_oversight_pulse", { p_worker_id: workerId, p_result: result });
    return Response.json({ ok: true, ...result });
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
    await db.rpc("finish_oversight_pulse", { p_worker_id: workerId, p_result: result });
    return Response.json({ ok: false, ...result }, { status: 500 });
  }
});
