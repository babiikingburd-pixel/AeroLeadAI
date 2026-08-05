import { supabaseServer } from "../../../../lib/supabaseServer";
import { applyEvidenceAndRescore } from "../../../../lib/twincities/evidenceEvents";
import { enrichLeadValue } from "../../../../lib/twincities/propertyValue";

export const maxDuration = 60;
const DEFAULT_LIMIT = 12;
const MAX_LIMIT = 25;
const CONCURRENCY = 4;

function auth(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  return req.headers.get("authorization") === `Bearer ${secret}` || new URL(req.url).searchParams.get("secret") === secret;
}

async function permitCheck(origin, row) {
  const address = `${row.address}, ${row.city}, MN`;
  try {
    const res = await fetch(`${origin}/api/permit-lookup?address=${encodeURIComponent(address)}`, { signal: AbortSignal.timeout(9000) });
    if (!res.ok) return { status: "failed", error: `HTTP ${res.status}` };
    const data = await res.json();
    const records = data.records || [];
    const tenYearsAgo = new Date();
    tenYearsAgo.setFullYear(tenYearsAgo.getFullYear() - 10);
    const roof = records.filter(p => p.roof_related || /roof/i.test(p.permit_type || ""));
    const recent = roof.filter(p => p.issue_date && new Date(p.issue_date) >= tenYearsAgo);
    return {
      status: records.length ? "verified" : "none_found",
      foundRecent: recent.length > 0,
      notes: JSON.stringify({ checked_at: new Date().toISOString(), records: records.length, roof_permits: roof.length, recent_roof_permits: recent.length, source: data.inDirectory ? "directory" : "external" }),
    };
  } catch (e) { return { status: "failed", error: e.message }; }
}

async function runOne(supabase, origin, row, workerId) {
  // Independent checks run concurrently. Imagery waits only on the permit gate.
  const [permit, value] = await Promise.all([
    permitCheck(origin, row),
    enrichLeadValue({ county: row.county, lat: row.lat, lon: row.lon, address: row.address }, supabase),
  ]);

  const patch = {
    permit_evidence_status: permit.status,
    permit_checked_at: permit.status === "failed" ? null : new Date().toISOString(),
    permit_notes: permit.notes || row.permit_notes || null,
    assessor_checked_at: value ? new Date().toISOString() : null,
    value_evidence_status: value?.assessedValue ? "verified" : "unknown",
    validation_worker_id: workerId,
  };
  if (permit.foundRecent != null) patch.permit_within_10y = permit.foundRecent;
  if (value?.assessedValue) patch.assessed_value = value.assessedValue;
  if (value?.yearBuilt) patch.year_built = value.yearBuilt;
  if (value?.source) patch.value_source = value.source;

  let rescored = await applyEvidenceAndRescore(supabase, row, patch, "twincities_validation_worker", {
    validation: true,
    permitStatus: permit.status,
    permitFound: permit.foundRecent ?? null,
    assessorValue: value?.assessedValue ?? null,
  });

  let image = "skipped";
  if (permit.foundRecent !== true && permit.status !== "failed" && row.lat != null && row.lon != null) {
    try {
      const res = await fetch(`${origin}/api/imagery-agent`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lat: row.lat, lon: row.lon, address: row.address, leadId: row.id, lite: true }),
        signal: AbortSignal.timeout(12000),
      });
      image = res.ok ? "verified" : `failed_${res.status}`;
      await supabase.from("batch_leads").update({ image_evidence_status: res.ok ? "verified" : "failed", image_fetched_at: res.ok ? new Date().toISOString() : null }).eq("id", row.id);
    } catch (e) { image = `error:${e.message}`; }
  }

  const validationScore = Math.round(Math.min(100, (
    (patch.permit_evidence_status === "verified" || patch.permit_evidence_status === "none_found" ? 30 : 0) +
    (patch.value_evidence_status === "verified" ? 25 : 0) +
    (row.hail_inches != null || row.wind_mph != null ? 20 : 0) +
    (image === "verified" ? 25 : 0)
  )) * 100) / 100;
  const recommendation = validationScore >= 80 ? "validated" : validationScore >= 50 ? "partial" : "needs_more_evidence";

  await supabase.from("batch_leads").update({
    validation_status: recommendation,
    validation_score: validationScore,
    validation_confidence: validationScore,
    last_validated_at: new Date().toISOString(),
    next_validation_at: new Date(Date.now() + (recommendation === "validated" ? 7 : 2) * 86400000).toISOString(),
  }).eq("id", row.id);

  return { id: row.id, scoreBefore: row.priority_score, scoreAfter: rescored.after, delta: rescored.delta, validationScore, recommendation, image };
}

export async function POST(req) {
  if (!auth(req)) return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const supabase = supabaseServer();
  if (!supabase) return Response.json({ ok: false, error: "Supabase not configured." }, { status: 500 });
  let body = {}; try { body = await req.json(); } catch {}
  const limit = Math.min(Number(body.limit) || DEFAULT_LIMIT, MAX_LIMIT);
  const workerId = body.workerId || `tc-validator-${Math.random().toString(36).slice(2, 8)}`;
  const origin = new URL(req.url).origin;

  const { data: jobs, error } = await supabase.from("twincities_validation_jobs")
    .select("id, property_id, priority, requested_checks")
    .eq("status", "queued").order("priority", { ascending: false }).limit(limit);
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
  if (!jobs?.length) return Response.json({ ok: true, claimed: 0, processed: 0, note: "Twin Cities validation queue empty." });

  const claimed = [];
  for (const job of jobs) {
    const { data } = await supabase.from("twincities_validation_jobs").update({ status: "running", claimed_by: workerId, claimed_at: new Date().toISOString(), attempts: (job.attempts || 0) + 1 }).eq("id", job.id).eq("status", "queued").select("id");
    if (data?.length) claimed.push(job);
  }

  const results = [];
  for (let i = 0; i < claimed.length; i += CONCURRENCY) {
    const batch = claimed.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.all(batch.map(async job => {
      const { data: row } = await supabase.from("batch_leads").select("*").eq("id", job.property_id).maybeSingle();
      if (!row) {
        await supabase.from("twincities_validation_jobs").update({ status: "failed", last_error: "Property not found" }).eq("id", job.id);
        return { id: job.property_id, ok: false, error: "Property not found" };
      }
      try {
        const result = await runOne(supabase, origin, row, workerId);
        await supabase.from("twincities_validation_jobs").update({ status: "completed", completed_at: new Date().toISOString() }).eq("id", job.id);
        return { ...result, ok: true };
      } catch (e) {
        await supabase.from("twincities_validation_jobs").update({ status: "failed", last_error: e.message, next_attempt_at: new Date(Date.now() + 15 * 60000).toISOString() }).eq("id", job.id);
        return { id: job.property_id, ok: false, error: e.message };
      }
    }));
    results.push(...batchResults);
  }

  return Response.json({ ok: true, workerId, claimed: claimed.length, processed: results.length, validated: results.filter(r => r.recommendation === "validated").length, results });
}
