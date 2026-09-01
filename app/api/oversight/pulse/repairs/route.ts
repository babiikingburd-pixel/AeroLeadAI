import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { createEvidenceProviders } from "@/lib/oversight/providers";
import { OversightPipeline } from "@/lib/oversight/pipeline";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
const BATCH_SIZE = 6;

const hash = (value: string) => createHash("sha256").update(value).digest("hex");

async function consumeToken(db: any, rawToken: string | null) {
  if (!rawToken || !/^[a-f0-9]{64}$/i.test(rawToken)) return false;
  const tokenHash = hash(rawToken);
  const now = new Date().toISOString();
  const { data: token } = await db.from("oversight_pulse_tokens").select("token_hash").eq("token_hash", tokenHash).is("used_at", null).gt("expires_at", now).maybeSingle();
  if (!token) return false;
  const { data: consumed } = await db.from("oversight_pulse_tokens").update({ used_at: now }).eq("token_hash", tokenHash).is("used_at", null).select("token_hash").maybeSingle();
  return Boolean(consumed);
}

function coords(payload: any) {
  const latitude = Number(payload?.latitude);
  const longitude = Number(payload?.longitude);
  return Number.isFinite(latitude) && Number.isFinite(longitude) ? { latitude, longitude } : {};
}

export async function POST(request: NextRequest) {
  const db = supabaseServer();
  if (!db) return NextResponse.json({ ok: false, error: "supabase_not_configured" }, { status: 503 });
  if (!await consumeToken(db, request.headers.get("x-oversight-pulse-token"))) return NextResponse.json({ ok: false, error: "invalid_or_expired_pulse_token" }, { status: 401 });

  const now = new Date().toISOString();
  const { data: tasks, error: taskError } = await db.from("oversight_audit_tasks")
    .select("parcel_id,requirement,priority,attempts")
    .eq("status", "READY")
    .lte("next_attempt_at", now)
    .order("priority", { ascending: false })
    .order("updated_at", { ascending: true })
    .limit(40);
  if (taskError) return NextResponse.json({ ok: false, error: taskError.message }, { status: 500 });

  const chosen: any[] = [];
  const seen = new Set<string>();
  for (const task of tasks || []) {
    if (seen.has(task.parcel_id)) continue;
    seen.add(task.parcel_id);
    chosen.push(task);
    if (chosen.length >= BATCH_SIZE) break;
  }
  if (!chosen.length) return NextResponse.json({ ok: true, attempted: 0, repaired: 0, remaining: 0 });

  const ids = chosen.map(x => x.parcel_id);
  const [{ data: profiles, error: profileError }, { data: structures, error: structureError }] = await Promise.all([
    db.from("roof_profiles").select("parcel_id,address,zip,state").in("parcel_id", ids),
    db.from("evidence_records").select("parcel_id,payload,captured_at").in("parcel_id", ids).eq("type", "STRUCTURE").in("reality", ["REAL_NOW","CACHED_REAL"]).order("captured_at", { ascending: false }),
  ]);
  if (profileError || structureError) return NextResponse.json({ ok: false, error: profileError?.message || structureError?.message }, { status: 500 });
  const structureByParcel = new Map<string, any>();
  for (const row of structures || []) if (!structureByParcel.has(row.parcel_id)) structureByParcel.set(row.parcel_id, row.payload || {});
  const profileByParcel = new Map((profiles || []).map((p: any) => [p.parcel_id, p]));

  const providers = createEvidenceProviders();
  const results: any[] = [];
  for (const task of chosen) {
    const profile: any = profileByParcel.get(task.parcel_id);
    if (!profile) continue;
    const structure = structureByParcel.get(task.parcel_id) || {};
    try {
      const result = await new OversightPipeline(db, providers).run({
        parcelId: profile.parcel_id,
        address: profile.address,
        zip: profile.zip || structure.zip || undefined,
        state: "MN",
        county: String(structure.county || ""),
        ...coords(structure),
      });
      await db.from("oversight_audit_tasks").update({ attempts: Number(task.attempts || 0) + 1, last_error: null, next_attempt_at: new Date(Date.now() + 30 * 60_000).toISOString(), updated_at: new Date().toISOString() }).eq("parcel_id", task.parcel_id).eq("requirement", task.requirement);
      results.push({ parcelId: task.parcel_id, requirement: task.requirement, state: result.decision.state, providerFailures: result.providerFailures });
    } catch (error) {
      const attempts = Number(task.attempts || 0) + 1;
      const delayMinutes = Math.min(1440, 15 * 2 ** Math.min(attempts, 6));
      const message = error instanceof Error ? error.message : "repair_failed";
      await db.from("oversight_audit_tasks").update({ attempts, last_error: message, next_attempt_at: new Date(Date.now() + delayMinutes * 60_000).toISOString(), updated_at: new Date().toISOString() }).eq("parcel_id", task.parcel_id).eq("requirement", task.requirement);
      results.push({ parcelId: task.parcel_id, requirement: task.requirement, error: message });
    }
  }
  await db.rpc("refresh_oversight_leaderboard");
  const { count: remaining } = await db.from("oversight_audit_tasks").select("parcel_id", { count: "exact", head: true }).eq("status", "READY");
  return NextResponse.json({ ok: true, attempted: results.length, repaired: results.filter(x => !x.error).length, remaining: remaining || 0, results });
}
