import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { OversightPipeline } from "@/lib/oversight/pipeline";
import { createEvidenceProvidersForEngine, crawlerGroupEngines, type CrawlerGroup } from "@/lib/oversight/providerGroups";

export const dynamic = "force-dynamic";
export const maxDuration = 300;
const BATCH_SIZE = 10;
const PARALLELISM = 5;

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
  if (requirement === "weather_history") return real.some(row => row.type === "WEATHER");
  if (requirement === "permit_history") return real.some(row => row.type === "PERMIT");
  if (requirement === "property_classification") return real.some(row => row.type === "STRUCTURE" && (row.payload?.property_class || row.payload?.dwelling_type || row.payload?.use_code));
  if (requirement === "year_built") return real.some(row => row.type === "STRUCTURE" && (row.payload?.year_built || row.payload?.YEAR_BUILT));
  if (requirement === "imagery_capture") return real.some(row => row.type === "IMAGERY");
  if (requirement === "imagery_date") return real.some(row => row.type === "IMAGERY" && (row.effectiveAt || row.payload?.captured_at || row.payload?.image_date || row.payload?.date));
  if (requirement === "imagery_analysis") return real.some(row => row.type === "IMAGERY" && (row.payload?.damage_probability != null || row.payload?.condition != null || row.payload?.analysis != null));
  return false;
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ group: string }> }) {
  const { group: rawGroup } = await params;
  const group = rawGroup.toUpperCase();
  if (!validGroup(group)) return NextResponse.json({ ok: false, error: "invalid_group" }, { status: 400 });
  const db = supabaseServer();
  if (!db) return NextResponse.json({ ok: false, error: "supabase_not_configured" }, { status: 503 });
  if (!await consumeToken(db, request.headers.get("x-oversight-pulse-token"))) return NextResponse.json({ ok: false, error: "invalid_or_expired_pulse_token" }, { status: 401 });

  await db.rpc("seed_oversight_crawler_jobs");
  const now = new Date().toISOString();
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
    if (chosen.length >= BATCH_SIZE) break;
  }
  if (!chosen.length) return NextResponse.json({ ok: true, group, engines: crawlerGroupEngines(group), attempted: 0 });

  const ids = chosen.map(job => job.parcel_id);
  const [{ data: profiles }, { data: structures }] = await Promise.all([
    db.from("roof_profiles").select("parcel_id,address,zip,state,live_rank").in("parcel_id", ids),
    db.from("evidence_records").select("parcel_id,payload,captured_at").in("parcel_id", ids).eq("type", "STRUCTURE").in("reality", ["REAL_NOW", "CACHED_REAL"]).order("captured_at", { ascending: false }),
  ]);
  const profileByParcel = new Map((profiles || []).map((row: any) => [row.parcel_id, row]));
  const structureByParcel = new Map<string, any>();
  for (const row of structures || []) if (!structureByParcel.has(row.parcel_id)) structureByParcel.set(row.parcel_id, row.payload || {});
  const run = await db.from("oversight_crawler_runs").insert({ worker_group: group, engine_type: `group_${group.toLowerCase()}`, metadata: { engines: crawlerGroupEngines(group), batchSize: BATCH_SIZE, parallelism: PARALLELISM } }).select("id").single();
  const results: any[] = [];

  async function execute(job: any) {
    const profile: any = profileByParcel.get(job.parcel_id);
    if (!profile) return { jobId: job.id, parcelId: job.parcel_id, error: "profile_missing" };
    await db.from("oversight_crawler_jobs").update({ status: "RUNNING", locked_at: new Date().toISOString(), locked_by: `group-${group}`, updated_at: new Date().toISOString() }).eq("id", job.id);
    const structure = structureByParcel.get(job.parcel_id) || {};
    try {
      const providers = createEvidenceProvidersForEngine(job.engine_type);
      if (!providers.length) {
        const attempts = Number(job.attempts || 0) + 1;
        await db.from("oversight_crawler_jobs").update({ status: "RETRY", attempts, last_error: "handled_by_imagery_pulse", next_attempt_at: new Date(Date.now() + 6 * 60 * 60_000).toISOString(), locked_at: null, locked_by: null, updated_at: new Date().toISOString() }).eq("id", job.id);
        return { jobId: job.id, parcelId: job.parcel_id, requirement: job.requirement, deferred: "imagery_pulse" };
      }
      const result = await new OversightPipeline(db, providers).run({ parcelId: profile.parcel_id, address: profile.address, zip: profile.zip || structure.zip || undefined, state: "MN", county: String(structure.county || ""), ...coords(structure) });
      const satisfied = requirementSatisfied(job.requirement, result.evidence);
      const attempts = Number(job.attempts || 0) + 1;
      const status = satisfied ? "DONE" : "RETRY";
      const delayMinutes = satisfied ? 0 : Math.min(720, 10 * 2 ** Math.min(attempts, 5));
      await db.from("oversight_crawler_jobs").update({ status, attempts, last_error: satisfied ? null : "evidence_not_yet_satisfied", next_attempt_at: new Date(Date.now() + delayMinutes * 60_000).toISOString(), locked_at: null, locked_by: null, updated_at: new Date().toISOString() }).eq("id", job.id);
      return { jobId: job.id, parcelId: job.parcel_id, requirement: job.requirement, rank: profile.live_rank, satisfied, providerFailures: result.providerFailures };
    } catch (error) {
      const attempts = Number(job.attempts || 0) + 1;
      const delayMinutes = Math.min(1440, 15 * 2 ** Math.min(attempts, 6));
      const message = error instanceof Error ? error.message : "crawler_failed";
      await db.from("oversight_crawler_jobs").update({ status: "RETRY", attempts, last_error: message, next_attempt_at: new Date(Date.now() + delayMinutes * 60_000).toISOString(), locked_at: null, locked_by: null, updated_at: new Date().toISOString() }).eq("id", job.id);
      return { jobId: job.id, parcelId: job.parcel_id, requirement: job.requirement, error: message };
    }
  }

  for (let i = 0; i < chosen.length; i += PARALLELISM) results.push(...await Promise.all(chosen.slice(i, i + PARALLELISM).map(execute)));
  if (run.data?.id) await db.from("oversight_crawler_runs").update({ finished_at: new Date().toISOString(), attempted: results.length, succeeded: results.filter(x => x.satisfied).length, failed: results.filter(x => x.error).length }).eq("id", run.data.id);
  return NextResponse.json({ ok: true, group, engines: crawlerGroupEngines(group), attempted: results.length, satisfied: results.filter(x => x.satisfied).length, results });
}
