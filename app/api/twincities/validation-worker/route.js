import { supabaseServer } from "../../../../lib/supabaseServer";
import { applyEvidenceAndRescore } from "../../../../lib/twincities/evidenceEvents";
import { enrichLeadValue } from "../../../../lib/twincities/propertyValue";
import {
  EVIDENCE_STATUS,
  IMAGE_RETRIEVAL_STATUS,
  JOB_STATUS,
  LEAD_VALIDATION_STATUS,
  MAX_ATTEMPTS,
  claimJobPatch,
  completeJobPatch,
  failJobPatch,
  imageRetrievalPatch,
  isImageReviewed,
} from "../../../../lib/twincities/validationState";
import { PAID_PROVIDERS, loadControls, record, reserve } from "../../../../lib/twincities/costGuard";

export const maxDuration = 60;
const DEFAULT_LIMIT = 12;
const MAX_LIMIT = 25;
const CONCURRENCY = 4;

function auth(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  return req.headers.get("authorization") === `Bearer ${secret}` || new URL(req.url).searchParams.get("secret") === secret;
}

// The permit lookup is billed per request. Every call goes through the cost
// guard first, and a refusal is reported as "skipped", never as "none_found" —
// not spending money is not the same as looking and finding nothing.
async function permitCheck(supabase, origin, row, workerId, controls) {
  const budget = await reserve(supabase, PAID_PROVIDERS.PERMIT, { controls });
  if (!budget.allowed) {
    return { status: EVIDENCE_STATUS.UNKNOWN, skipped: true, error: budget.reason };
  }

  const address = `${row.address}, ${row.city}, MN`;
  try {
    const res = await fetch(`${origin}/api/permit-lookup?address=${encodeURIComponent(address)}`, { signal: AbortSignal.timeout(9000) });
    await record(supabase, PAID_PROVIDERS.PERMIT, {
      worker: workerId, leadId: row.id, ok: res.ok, detail: `HTTP ${res.status}`,
    });
    if (!res.ok) return { status: EVIDENCE_STATUS.FAILED, error: `HTTP ${res.status}` };
    const data = await res.json();
    const records = data.records || [];
    const tenYearsAgo = new Date();
    tenYearsAgo.setFullYear(tenYearsAgo.getFullYear() - 10);
    const roof = records.filter(p => p.roof_related || /roof/i.test(p.permit_type || ""));
    const recent = roof.filter(p => p.issue_date && new Date(p.issue_date) >= tenYearsAgo);
    return {
      status: records.length ? EVIDENCE_STATUS.VERIFIED : EVIDENCE_STATUS.NONE_FOUND,
      foundRecent: recent.length > 0,
      notes: JSON.stringify({ checked_at: new Date().toISOString(), records: records.length, roof_permits: roof.length, recent_roof_permits: recent.length, source: data.inDirectory ? "directory" : "external" }),
    };
  } catch (e) {
    await record(supabase, PAID_PROVIDERS.PERMIT, {
      worker: workerId, leadId: row.id, ok: false, detail: e.message,
    });
    return { status: EVIDENCE_STATUS.FAILED, error: e.message };
  }
}

async function runOne(supabase, origin, row, workerId, controls) {
  const [permit, value] = await Promise.all([
    permitCheck(supabase, origin, row, workerId, controls),
    enrichLeadValue({ county: row.county, lat: row.lat, lon: row.lon, address: row.address }, supabase),
  ]);

  const checkedAt = new Date().toISOString();
  const patch = {
    permit_evidence_status: permit.status,
    permit_checked_at: permit.status === EVIDENCE_STATUS.FAILED || permit.skipped ? null : checkedAt,
    permit_notes: permit.notes || row.permit_notes || null,
    assessor_checked_at: value ? checkedAt : null,
    value_evidence_status: value?.assessedValue ? EVIDENCE_STATUS.VERIFIED : EVIDENCE_STATUS.UNKNOWN,
    validation_worker_id: workerId,
  };
  if (permit.foundRecent != null) patch.permit_within_10y = permit.foundRecent;
  if (value?.assessedValue) patch.assessed_value = value.assessedValue;
  if (value?.yearBuilt) patch.year_built = value.yearBuilt;
  if (value?.source) patch.value_source = value.source;

  const rescored = await applyEvidenceAndRescore(supabase, row, patch, "twincities_validation_worker", {
    validation: true,
    permitStatus: permit.status,
    permitFound: permit.foundRecent ?? null,
    assessorValue: value?.assessedValue ?? null,
    workerId,
  });

  let image = "not_requested";
  const imageryEligible =
    permit.foundRecent !== true &&
    permit.status !== EVIDENCE_STATUS.FAILED &&
    row.lat != null && row.lon != null;
  if (imageryEligible) {
    const budget = await reserve(supabase, PAID_PROVIDERS.IMAGERY, { controls });
    if (!budget.allowed) {
      image = `skipped_no_budget: ${budget.reason}`;
      await supabase.from("batch_leads")
        .update(imageRetrievalPatch(IMAGE_RETRIEVAL_STATUS.SKIPPED_NO_BUDGET, checkedAt))
        .eq("id", row.id);
    } else {
      try {
        const res = await fetch(`${origin}/api/imagery-agent`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ lat: row.lat, lon: row.lon, address: row.address, leadId: row.id, lite: true }),
          signal: AbortSignal.timeout(12000),
        });
        await record(supabase, PAID_PROVIDERS.IMAGERY, {
          worker: workerId, leadId: row.id, ok: res.ok, detail: `HTTP ${res.status}`,
        });
        // Fetching imagery is NOT validation. imageRetrievalPatch() owns the
        // column so no worker can write "verified" into it again.
        image = res.ok ? "fetched" : `failed_${res.status}`;
        await supabase.from("batch_leads")
          .update(imageRetrievalPatch(res.ok, checkedAt))
          .eq("id", row.id);
      } catch (e) {
        await record(supabase, PAID_PROVIDERS.IMAGERY, {
          worker: workerId, leadId: row.id, ok: false, detail: e.message,
        });
        image = `error:${e.message}`;
      }
    }
  }

  const stormPresent = row.hail_inches != null || row.wind_mph != null || row.storm_date != null;
  const imageReviewed = isImageReviewed(row);

  // Evidence completeness is deliberately different from lead quality.
  // "Checked and nothing found" is valid coverage, but it is not a positive
  // damage signal. An image fetch is also not a review.
  const validationScore = Math.round((
    (permit.status === EVIDENCE_STATUS.VERIFIED || permit.status === EVIDENCE_STATUS.NONE_FOUND ? 20 : 0) +
    (value?.assessedValue ? 20 : 0) +
    (stormPresent ? 25 : 0) +
    (image === "fetched" ? 10 : 0) +
    (imageReviewed ? 25 : 0)
  ) * 100) / 100;

  const recommendation =
    validationScore >= 80 && imageReviewed ? LEAD_VALIDATION_STATUS.VALIDATED :
    validationScore >= 50 ? LEAD_VALIDATION_STATUS.PARTIAL : LEAD_VALIDATION_STATUS.NEEDS_MORE_EVIDENCE;

  const validationConfidence = Math.min(
    100,
    Math.round(
      (permit.status === EVIDENCE_STATUS.VERIFIED ? 25 : permit.status === EVIDENCE_STATUS.NONE_FOUND ? 15 : 0) +
      (value?.assessedValue ? 25 : 0) +
      (stormPresent ? 20 : 0) +
      (imageReviewed ? 30 : image === "fetched" ? 5 : 0)
    )
  );

  await supabase.from("batch_leads").update({
    validation_status: recommendation,
    validation_score: validationScore,
    validation_confidence: validationConfidence,
    last_validated_at: checkedAt,
    next_validation_at: new Date(Date.now() + (recommendation === LEAD_VALIDATION_STATUS.VALIDATED ? 7 : 2) * 86400000).toISOString(),
    validation_evidence_version: "APEX10.1",
  }).eq("id", row.id);

  return {
    id: row.id,
    scoreBefore: row.priority_score,
    scoreAfter: rescored.after,
    delta: rescored.delta,
    validationScore,
    validationConfidence,
    recommendation,
    permitStatus: permit.status,
    assessorVerified: !!value?.assessedValue,
    stormPresent,
    image,
    imageReviewed,
  };
}

export async function POST(req) {
  if (!auth(req)) return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const supabase = supabaseServer();
  if (!supabase) return Response.json({ ok: false, error: "Supabase not configured." }, { status: 500 });
  let body = {}; try { body = await req.json(); } catch {}
  const limit = Math.min(Number(body.limit) || DEFAULT_LIMIT, MAX_LIMIT);
  const workerId = body.workerId || `tc-validator-${Math.random().toString(36).slice(2, 8)}`;
  const origin = new URL(req.url).origin;

  // Read once per invocation rather than per job: the caps are enforced against
  // the ledger, not against this snapshot, so a stale copy cannot overspend.
  const controls = await loadControls(supabase);
  if (controls.paid_lookups_enabled === false) {
    return Response.json({
      ok: false,
      halted: true,
      reason: controls.paid_lookups_disabled_reason || "paid lookups disabled",
      disabledAt: controls.paid_lookups_disabled_at ?? null,
      note: "Cost guard has tripped. Clear it with costGuard.reset() once the cause is understood.",
    }, { status: 503 });
  }

  const { data: jobs, error } = await supabase.from("twincities_validation_jobs")
    .select("id, property_id, priority, requested_checks, attempts, status")
    .eq("status", JOB_STATUS.QUEUED)
    .or(`next_attempt_at.is.null,next_attempt_at.lte.${new Date().toISOString()}`)
    .order("priority", { ascending: false })
    .limit(limit);
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
  if (!jobs?.length) return Response.json({ ok: true, claimed: 0, processed: 0, note: "Twin Cities validation queue empty." });

  const claimed = [];
  for (const job of jobs) {
    // The .eq("status", QUEUED) on the update is the claim: two workers racing
    // for the same job, only one update matches a row.
    const { data } = await supabase.from("twincities_validation_jobs")
      .update(claimJobPatch(job, workerId))
      .eq("id", job.id)
      .eq("status", JOB_STATUS.QUEUED)
      .select("id");
    if (data?.length) claimed.push({ ...job, attempts: Number(job.attempts || 0) + 1 });
  }

  const results = [];
  for (let i = 0; i < claimed.length; i += CONCURRENCY) {
    const batch = claimed.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.all(batch.map(async job => {
      const { data: row } = await supabase.from("batch_leads").select("*").eq("id", job.property_id).maybeSingle();
      if (!row) {
        // Terminal, not retryable: a missing property will still be missing in
        // fifteen minutes.
        const { patch } = failJobPatch(job.attempts, "Property not found", { terminal: true });
        await supabase.from("twincities_validation_jobs").update(patch).eq("id", job.id);
        return { id: job.property_id, ok: false, error: "Property not found", exhausted: true };
      }
      try {
        const result = await runOne(supabase, origin, row, workerId, controls);
        await supabase.from("twincities_validation_jobs").update(completeJobPatch()).eq("id", job.id);
        return { ...result, ok: true };
      } catch (e) {
        // job.attempts already includes the attempt that just failed — the
        // claim incremented it. failJobPatch decides retry vs. give up and
        // computes the exponential backoff.
        const { patch, retrying, attempts, retryInMs } = failJobPatch(job.attempts, e);
        await supabase.from("twincities_validation_jobs").update(patch).eq("id", job.id);
        return {
          id: job.property_id, ok: false, error: e.message,
          attempts, exhausted: !retrying,
          retryInSeconds: retrying ? Math.round(retryInMs / 1000) : null,
        };
      }
    }));
    results.push(...batchResults);
  }

  return Response.json({
    ok: true,
    version: "APEX10.1",
    workerId,
    maxAttempts: MAX_ATTEMPTS,
    claimed: claimed.length,
    processed: results.length,
    validated: results.filter(r => r.recommendation === LEAD_VALIDATION_STATUS.VALIDATED).length,
    partial: results.filter(r => r.recommendation === LEAD_VALIDATION_STATUS.PARTIAL).length,
    retrying: results.filter(r => r.ok === false && r.exhausted === false).length,
    gaveUp: results.filter(r => r.exhausted === true).length,
    results
  });
}
