import { supabaseServer } from "../../../../lib/supabaseServer";
import { applyEvidenceAndRescore } from "../../../../lib/twincities/evidenceEvents";
export const dynamic = "force-dynamic";

// PRIORITY ENRICHMENT WORKER
//
// Drains the targeted enrichment queue. Deliberately NOT a bulk crawler —
// storm data is a bulk NOAA operation handled by /api/enrich/storm-backfill.
// This worker spends the SCARCE, per-address resources (permit API calls,
// imagery bandwidth) only on leads that already scored well enough to earn
// them.
//
// Sequence per lead, and the order is the point:
//   1. CLAIM   -> atomically take the job so two workers can't crawl the
//                 same address concurrently.
//   2. PERMIT  -> GET /api/permit-lookup?address=... (the real lookup).
//                 NOTE: the POST handler on that route is a manual-save
//                 endpoint that inserts a permit row with source:"manual" —
//                 calling it here would fabricate an empty record and then
//                 report success. Must be GET.
//   3. RESCORE -> re-run calculatePriority with the real permit result.
//   4. GATE    -> if a roof permit was pulled within 10 years, the lead is
//                 downranked and we STOP. No imagery spend on a roof that
//                 was already replaced.
//   5. IMAGE   -> only for leads that survived the permit gate.
//
// Every evidence field gets an explicit status so the gap router can tell
// "looked and found nothing" apart from "never looked".
//
// POST /api/enrich/priority-worker { limit?, skipImages?, workerId? }

export const maxDuration = 300;

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

// Every write that matters is checked. Silently swallowing an update error
// here would leave a lead marked un-enriched after we already spent the API
// call on it — or worse, marked enriched with nothing actually saved.
async function mustUpdate(supabase, id, patch, what) {
  const { error } = await supabase.from("batch_leads").update(patch).eq("id", id);
  if (error) throw new Error(`${what} failed for ${id}: ${error.message}`);
}

export async function POST(req) {
  const supabase = supabaseServer();
  if (!supabase) return Response.json({ ok: false, error: "Supabase not configured." }, { status: 500 });

  let body = {};
  try { body = await req.json(); } catch {}
  const limit = Math.min(body.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
  const skipImages = body.skipImages === true;
  const workerId = body.workerId || `worker-${Math.random().toString(36).slice(2, 8)}`;
  const origin = new URL(req.url).origin;

  // --- 1. CLAIM a batch ---
  // Select, then conditionally update with enrichment_status still 'pending'
  // in the WHERE clause. A second worker that grabbed the same row loses the
  // race (0 rows updated) and skips it instead of double-crawling.
  const { data: candidates, error: selErr } = await supabase
    .from("batch_leads")
    .select("*")
    .eq("enrichment_queue", "priority")
    .eq("enrichment_status", "pending")
    .order("gap_priority", { ascending: false, nullsFirst: false })
    .order("priority_score", { ascending: false })
    .limit(limit);

  if (selErr) return Response.json({ ok: false, error: selErr.message }, { status: 500 });
  if (!candidates?.length) {
    return Response.json({ ok: true, processed: 0, note: "Priority queue empty. Promote more leads first." });
  }

  const claimed = [];
  for (const row of candidates) {
    const { data, error } = await supabase
      .from("batch_leads")
      .update({
        enrichment_status: "claimed",
        enrichment_worker_id: workerId,
        enrichment_started_at: new Date().toISOString(),
        enrichment_attempts: (row.enrichment_attempts ?? 0) + 1,
      })
      .eq("id", row.id)
      .eq("enrichment_status", "pending")
      .select("id");
    if (!error && data?.length) claimed.push(row);
  }

  if (!claimed.length) {
    return Response.json({ ok: true, processed: 0, note: "All candidates were claimed by another worker." });
  }

  const results = [];

  for (const row of claimed) {
    const before = row.priority_score;
    let permitFound = null;
    let permitNotes = null;
    let permitError = null;
    let permitStatus = "failed";

    // --- 2. PERMIT LOOKUP (GET — the real lookup) ---
    try {
      const addr = `${row.address}, ${row.city}, MN`;
      const res = await fetch(`${origin}/api/permit-lookup?address=${encodeURIComponent(addr)}`);
      if (res.ok) {
        const data = await res.json();
        const records = data.records || [];
        const roofPermits = records.filter((p) => p.roof_related || /roof/i.test(p.permit_type || ""));
        const tenYearsAgo = new Date();
        tenYearsAgo.setFullYear(tenYearsAgo.getFullYear() - 10);
        const recent = roofPermits.filter((p) => p.issue_date && new Date(p.issue_date) >= tenYearsAgo);

        permitFound = recent.length > 0;
        // 'verified' when records came back; 'none_found' when the lookup ran
        // cleanly and there genuinely is nothing. Both are real evidence.
        // Neither is 'unknown'.
        permitStatus = records.length > 0 ? "verified" : "none_found";
        permitNotes = JSON.stringify({
          checked_at: new Date().toISOString(),
          source: data.inDirectory ? "permit_directory" : "lookup",
          total_records: records.length,
          roof_permits: roofPermits.length,
          roof_permits_within_10y: recent.length,
          most_recent: recent[0]?.issue_date || roofPermits[0]?.issue_date || null,
          low_priority_reason: data.lowPriorityReason || null,
        });
      } else {
        permitError = `permit-lookup HTTP ${res.status}`;
      }
    } catch (e) {
      permitError = e.message;
    }

    // --- 3/4. RESCORE + PERMIT GATE via the shared evidence-event handler ---
    // (was: hand-rolled calculatePriority + update + score_history insert,
    // duplicated near-verbatim in storm-backfill — now one function both use.)
    const evidencePatch = {
      permit_evidence_status: permitStatus,
      permit_checked_at: permitNotes ? new Date().toISOString() : null,
    };
    if (permitFound !== null) evidencePatch.permit_within_10y = permitFound;
    if (permitNotes) evidencePatch.permit_notes = permitNotes;

    const gatedOut = permitFound === true;
    if (gatedOut) {
      evidencePatch.enrichment_status = "complete_downranked";
      evidencePatch.enrichment_completed_at = new Date().toISOString();
      evidencePatch.image_evidence_status = "skipped_permit_gate";
    } else if (permitError) {
      evidencePatch.enrichment_status = "pending"; // failed lookup -> retryable, not a finding
      evidencePatch.permit_evidence_status = "failed";
    } else {
      evidencePatch.enrichment_status = "permit_done";
    }

    let rescoreResult;
    try {
      rescoreResult = await applyEvidenceAndRescore(supabase, row, evidencePatch, "priority_worker_permit", {
        permitStatus, permitFound, permitError, gapRoute: row.gap_route || null, gapPriority: row.gap_priority || null,
      });
    } catch (e) {
      results.push({ id: row.id, address: row.address, error: e.message, saved: false });
      continue;
    }

    // --- 5. IMAGE (only past the permit gate) ---
    let imageStatus = gatedOut ? "skipped_permit_gate" : (permitError ? "skipped_permit_failed" : "skipped");
    if (!gatedOut && !permitError && !skipImages && row.lat != null && row.lon != null) {
      try {
        const imgRes = await fetch(`${origin}/api/imagery-agent`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ lat: row.lat, lon: row.lon, address: row.address, leadId: row.id }),
        });
        imageStatus = imgRes.ok ? "fetched" : `failed_${imgRes.status}`;
        await mustUpdate(supabase, row.id, {
          image_evidence_status: imgRes.ok ? "verified" : "failed",
          image_fetched_at: imgRes.ok ? new Date().toISOString() : null,
          enrichment_status: imgRes.ok ? "complete" : "image_failed",
          enrichment_completed_at: imgRes.ok ? new Date().toISOString() : null,
        }, "image status save");
      } catch (e) {
        imageStatus = `error: ${e.message}`;
      }
    }

    results.push({
      id: row.id,
      address: row.address,
      city: row.city,
      scoreBefore: before,
      scoreAfter: rescoreResult.after,
      delta: rescoreResult.delta,
      permitWithin10y: permitFound,
      permitStatus,
      permitError,
      gatedOut,
      tier: rescoreResult.scored.tier,
      confidence: rescoreResult.scored.confidenceScore,
      historyFailed: rescoreResult.historyFailed,
      image: imageStatus,
      saved: true,
    });
  }

  const ok = results.filter((r) => r.saved);

  // Self-maintaining queue: after gate-outs and completions, top the active
  // queue back up to targetSize rather than leaving it to shrink. This is
  // the achievable version of "continuously replace #500" on a serverless
  // platform — no persistent loop, just: every time work happens, also ask
  // "does the pool need refilling?" State lives in the database; there is
  // no long-running process to keep alive.
  let topUp = null;
  if (body.autoTopUp !== false) {
    try {
      const topUpRes = await fetch(`${origin}/api/enrich/promote-queue`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetSize: body.targetSize ?? 500 }),
      });
      topUp = topUpRes.ok ? await topUpRes.json() : { ok: false, error: `HTTP ${topUpRes.status}` };
    } catch (e) {
      topUp = { ok: false, error: e.message };
    }
  }

  return Response.json({
    ok: true,
    workerId,
    claimed: claimed.length,
    processed: results.length,
    summary: {
      permits_actually_checked: ok.filter((r) => r.permitStatus === "verified" || r.permitStatus === "none_found").length,
      permits_found_recent: ok.filter((r) => r.permitWithin10y === true).length,
      gated_out_before_imagery: ok.filter((r) => r.gatedOut).length,
      dropped_after_permit_check: ok.filter((r) => r.delta < 0).length,
      lookup_failures_requeued: ok.filter((r) => r.permitError).length,
      images_fetched: ok.filter((r) => r.image === "fetched").length,
      save_failures: results.filter((r) => r.saved === false).length,
    },
    topUp,
    results,
  });
}
