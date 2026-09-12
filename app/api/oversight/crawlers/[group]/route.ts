import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { OversightPipeline } from "@/lib/oversight/pipeline";
import { createEvidenceProvidersForEngine, crawlerGroupEngines, type CrawlerGroup } from "@/lib/oversight/providerGroups";
import { runSuperbRequirement, supportsNativeRequirement } from "@/lib/oversight/superbWorkers";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
const STALE_LOCK_MS = 10 * 60_000;

const hash = (value: string) => createHash("sha256").update(value).digest("hex");

async function consumeToken(db: any, rawToken: string | null) {
  if (!rawToken || !/^[a-f0-9]{64}$/i.test(rawToken)) return false;
  const tokenHash = hash(rawToken);
  const now = new Date().toISOString();
  const { data: token } = await db.from("oversight_pulse_tokens")
    .select("token_hash").eq("token_hash", tokenHash).is("used_at", null).gt("expires_at", now).maybeSingle();
  if (!token) return false;
  const { data: consumed } = await db.from("oversight_pulse_tokens")
    .update({ used_at: now }).eq("token_hash", tokenHash).is("used_at", null).select("token_hash").maybeSingle();
  return Boolean(consumed);
}

function validGroup(value: string): value is CrawlerGroup { return value === "A" || value === "B"; }
function coords(payload: any) {
  const latitude = Number(payload?.latitude);
  const longitude = Number(payload?.longitude);
  return Number.isFinite(latitude) && Number.isFinite(longitude) ? { latitude, longitude } : {};
}

function requirementSatisfied(requirement: string, evidence: any[]) {
  const real = evidence.filter(row => ["REAL_NOW", "CACHED_REAL"].includes(row.reality));
  if (requirement === "identity") return real.some(row => row.type === "PROPERTY" && Number(row.confidence || 0) >= .85);
  if (requirement === "weather_history") return real.some(row => row.type === "WEATHER" && !row.payload?.reason && !row.payload?.error && row.payload?.search_status !== "partial");
  if (requirement === "permit_history") return real.some(row => row.type === "PERMIT" && !row.payload?.reason && !row.payload?.error);
  if (requirement === "property_classification") return real.some(row => row.type === "STRUCTURE" && (row.payload?.property_class || row.payload?.property_type || row.payload?.dwelling_type || row.payload?.use_type || row.payload?.use_code));
  if (requirement === "year_built") return real.some(row => row.type === "STRUCTURE" && (row.payload?.year_built || row.payload?.yearBuilt || row.payload?.effective_year_built || row.payload?.YEAR_BUILT));
  if (requirement === "imagery_capture") return real.some(row => row.type === "IMAGERY" && row.payload?.storage_path);
  if (requirement === "imagery_date") return real.some(row => row.type === "IMAGERY" && (
    row.effective_at || row.effectiveAt || row.payload?.capture_date || row.payload?.captured_at || row.payload?.image_date || row.payload?.date ||
    row.payload?.capture_date_status === "provider_does_not_expose_capture_date"
  ));
  if (requirement === "imagery_analysis") return real.some(row => row.type === "IMAGERY" && (
    ["complete", "completed", "analyzed", "reviewed"].includes(String(row.payload?.damage_analysis_status || row.payload?.analysis_status || "").toLowerCase()) ||
    row.payload?.possible_concern_score != null || row.payload?.damage_probability != null || row.payload?.condition != null || row.payload?.analysis != null
  ));
  return false;
}

async function parcelEvidence(db: any, parcelId: string) {
  const { data, error } = await db.from("evidence_records")
    .select("parcel_id,type,reality,confidence,effective_at,payload,captured_at")
    .eq("parcel_id", parcelId)
    .order("captured_at", { ascending: false })
    .limit(500);
  if (error) throw new Error(`evidence_read_failed: ${error.message}`);
  return data || [];
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ group: string }> }) {
  const { group: rawGroup } = await params;
  const group = rawGroup.toUpperCase();
  if (!validGroup(group)) return NextResponse.json({ ok: false, error: "invalid_group" }, { status: 400 });
  const db = supabaseServer();
  if (!db) return NextResponse.json({ ok: false, error: "supabase_not_configured" }, { status: 503 });
  if (!await consumeToken(db, request.headers.get("x-oversight-pulse-token"))) return NextResponse.json({ ok: false, error: "invalid_or_expired_pulse_token" }, { status: 401 });

  const batchSize = group === "B" ? 2 : 6;
  const parallelism = group === "B" ? 2 : 3;
  const now = new Date().toISOString();
  const staleBefore = new Date(Date.now() - STALE_LOCK_MS).toISOString();

  const { error: staleLockError } = await db.from("oversight_crawler_jobs")
    .update({ status: "RETRY", locked_at: null, locked_by: null, next_attempt_at: now, last_error: "stale_worker_lock_recovered", updated_at: now })
    .eq("worker_group", group).eq("status", "RUNNING").lt("locked_at", staleBefore);
  if (staleLockError) return NextResponse.json({ ok: false, error: `stale_lock_recovery_failed: ${staleLockError.message}` }, { status: 500 });

  await db.rpc("seed_oversight_crawler_jobs");
  const { data: candidates, error: queueError } = await db.from("oversight_crawler_jobs")
    .select("id,parcel_id,engine_type,requirement,priority,rank_tier,attempts")
    .eq("worker_group", group).in("status", ["READY", "RETRY"]).lte("next_attempt_at", now)
    .order("priority", { ascending: false }).order("created_at", { ascending: true }).limit(80);
  if (queueError) return NextResponse.json({ ok: false, error: queueError.message }, { status: 500 });

  const chosen: any[] = [];
  const seen = new Set<string>();
  for (const job of candidates || []) {
    if (seen.has(job.parcel_id)) continue;
    seen.add(job.parcel_id); chosen.push(job);
    if (chosen.length >= batchSize) break;
  }
  if (!chosen.length) return NextResponse.json({ ok: true, group, engines: crawlerGroupEngines(group), attempted: 0 });

  const ids = chosen.map(job => job.parcel_id);
  const [{ data: profiles, error: profileError }, { data: structures, error: structureError }, { data: currentEvidence, error: evidenceError }] = await Promise.all([
    db.from("roof_profiles").select("parcel_id,address,zip,state,live_rank").in("parcel_id", ids),
    db.from("evidence_records").select("parcel_id,payload,captured_at").in("parcel_id", ids).eq("type", "STRUCTURE").in("reality", ["REAL_NOW", "CACHED_REAL"]).order("captured_at", { ascending: false }),
    db.from("evidence_records").select("parcel_id,type,reality,confidence,effective_at,payload,captured_at").in("parcel_id", ids).order("captured_at", { ascending: false }).limit(3000),
  ]);
  if (profileError || structureError || evidenceError) return NextResponse.json({ ok: false, error: profileError?.message || structureError?.message || evidenceError?.message }, { status: 500 });

  const profileByParcel = new Map((profiles || []).map((row: any) => [row.parcel_id, row]));
  const structureByParcel = new Map<string, any>();
  for (const row of structures || []) if (!structureByParcel.has(row.parcel_id)) structureByParcel.set(row.parcel_id, row.payload || {});
  const evidenceByParcel = new Map<string, any[]>();
  for (const row of currentEvidence || []) evidenceByParcel.set(row.parcel_id, [...(evidenceByParcel.get(row.parcel_id) || []), row]);

  const run = await db.from("oversight_crawler_runs").insert({ worker_group: group, engine_type: `group_${group.toLowerCase()}`, metadata: { engines: crawlerGroupEngines(group), batchSize, parallelism, nativeWorkers: true, strictCompletion: true } }).select("id").single();
  const results: any[] = [];

  async function finishJob(job: any, satisfied: boolean, attempts: number, error: string | null = null) {
    const status = satisfied ? "DONE" : "RETRY";
    const delayMinutes = satisfied ? 0 : Math.min(720, 10 * 2 ** Math.min(attempts, 5));
    await db.from("oversight_crawler_jobs").update({
      status,
      attempts,
      last_error: satisfied ? null : error || "evidence_not_yet_satisfied",
      next_attempt_at: new Date(Date.now() + delayMinutes * 60_000).toISOString(),
      locked_at: null,
      locked_by: null,
      updated_at: new Date().toISOString(),
    }).eq("id", job.id);
  }

  async function execute(job: any) {
    const profile: any = profileByParcel.get(job.parcel_id);
    if (!profile) return { jobId: job.id, parcelId: job.parcel_id, error: "profile_missing" };
    await db.from("oversight_crawler_jobs").update({ status: "RUNNING", locked_at: new Date().toISOString(), locked_by: `group-${group}`, updated_at: new Date().toISOString() }).eq("id", job.id);
    const structure = structureByParcel.get(job.parcel_id) || {};
    const attempts = Number(job.attempts || 0) + 1;

    try {
      const existing = evidenceByParcel.get(job.parcel_id) || [];
      if (requirementSatisfied(job.requirement, existing)) {
        await finishJob(job, true, attempts);
        return { jobId: job.id, parcelId: job.parcel_id, requirement: job.requirement, rank: profile.live_rank, satisfied: true, source: "existing_evidence" };
      }

      if (supportsNativeRequirement(job.requirement)) {
        const native = await runSuperbRequirement({ db, origin: request.nextUrl.origin, profile, structure, requirement: job.requirement });
        const refreshed = await parcelEvidence(db, job.parcel_id);
        const satisfied = native.satisfied || requirementSatisfied(job.requirement, refreshed);
        await finishJob(job, satisfied, attempts, satisfied ? null : `native_${native.provider}_not_satisfied`);
        return { jobId: job.id, parcelId: job.parcel_id, requirement: job.requirement, rank: profile.live_rank, satisfied, source: native.provider, detail: native.detail || null };
      }

      const providers = createEvidenceProvidersForEngine(job.engine_type);
      if (!providers.length) {
        await finishJob(job, false, attempts, "no_provider_for_requirement");
        return { jobId: job.id, parcelId: job.parcel_id, requirement: job.requirement, satisfied: false, error: "no_provider_for_requirement" };
      }
      const result = await new OversightPipeline(db, providers).run({ parcelId: profile.parcel_id, address: profile.address, zip: profile.zip || structure.zip || undefined, state: "MN", county: String(structure.county || ""), ...coords(structure) });
      const satisfied = requirementSatisfied(job.requirement, result.evidence);
      await finishJob(job, satisfied, attempts);
      return { jobId: job.id, parcelId: job.parcel_id, requirement: job.requirement, rank: profile.live_rank, satisfied, providerFailures: result.providerFailures, degraded: result.degraded };
    } catch (error) {
      const delayMinutes = Math.min(1440, 15 * 2 ** Math.min(attempts, 6));
      const message = error instanceof Error ? error.message : "crawler_failed";
      await db.from("oversight_crawler_jobs").update({ status: "RETRY", attempts, last_error: message, next_attempt_at: new Date(Date.now() + delayMinutes * 60_000).toISOString(), locked_at: null, locked_by: null, updated_at: new Date().toISOString() }).eq("id", job.id);
      return { jobId: job.id, parcelId: job.parcel_id, requirement: job.requirement, error: message };
    }
  }

  for (let i = 0; i < chosen.length; i += parallelism) results.push(...await Promise.all(chosen.slice(i, i + parallelism).map(execute)));
  if (run.data?.id) await db.from("oversight_crawler_runs").update({ finished_at: new Date().toISOString(), attempted: results.length, succeeded: results.filter(x => x.satisfied).length, failed: results.filter(x => x.error).length }).eq("id", run.data.id);
  return NextResponse.json({ ok: true, group, engines: crawlerGroupEngines(group), attempted: results.length, satisfied: results.filter(x => x.satisfied).length, nativeWorkers: true, strictCompletion: true, results });
}
