import { calculatePriority } from "./priorityEngine";
import crypto from "crypto";

// EVIDENCE EVENT HANDLER
//
// Scoped-down version of the "evidence event pipeline" idea: rather than
// building a full event-sourced property_intelligence store (a real
// rearchitecture, and premature while only permit + storm actually produce
// evidence), this is the one thing that was genuinely duplicated —
// priority-worker and storm-backfill each independently rebuilt the same
// "merge evidence -> rescore -> write -> log to score_history" block. Now
// there's one function both call.
//
// Any future evidence producer (a driveway detector, a gutter detector,
// whatever comes next) calls this the same way. They don't invent their own
// scoring or history logic — they just say what changed and why.
//
// NOT built here (deliberately): a normalized property_intelligence JSON
// object, per-signal confidence, or multi-contractor opportunity scores.
// Those need real condition signals (driveway/gutter/tree) that don't exist
// yet — building the interface for data that isn't there yet is scaffolding
// with nothing to hang on it.

export async function applyEvidenceAndRescore(supabase, leadRow, evidencePatch, changedBy, reasonMeta = {}) {
  const before = leadRow.priority_score;
  const permitChecked = evidencePatch.permitChecked ?? !!(leadRow.permit_notes && leadRow.permit_notes.length > 0);

  const merged = {
    county: leadRow.county,
    yearBuilt: leadRow.year_built,
    permit_within_10y: evidencePatch.permit_within_10y ?? leadRow.permit_within_10y,
    permitChecked,
    hailInches: evidencePatch.hail_inches ?? leadRow.hail_inches,
    windMph: evidencePatch.wind_mph ?? leadRow.wind_mph,
    assessedValue: leadRow.assessed_value,
    reviewStatus: leadRow.review_status,
    roofEstimateUsd: leadRow.replacement_cost ?? null,
    treeOverhang: leadRow.damage_notes?.treeOverhang === true,
    largeOverhang: leadRow.damage_notes?.largeOverhang === true,
    drivewayCrackRisk: (leadRow.driveway_score ?? 0) >= 50,
    gutterIndicator: leadRow.damage_notes?.gutterIndicator === true,
  };

  const scored = calculatePriority(merged);
  const after = scored.entered ? scored.priorityScore : 0;

  const dbPatch = {
    ...evidencePatch,
    priority_score: after,
    evidence_score: scored.evidenceScore ?? 0,
    confidence_score: scored.confidenceScore ?? 0,
    tier: scored.tier ?? "investigate",
    score_model: changedBy,
    scored_at: new Date().toISOString(),
  };
  delete dbPatch.permitChecked; // scoring-only field, not a DB column

  const { error: updateErr } = await supabase.from("batch_leads").update(dbPatch).eq("id", leadRow.id);
  if (updateErr) throw new Error(`applyEvidenceAndRescore update failed for ${leadRow.id}: ${updateErr.message}`);

  const { error: histErr } = await supabase.from("score_history").insert({
    lead_id: leadRow.id,
    score_before: before,
    score_after: after,
    changed_by: changedBy,
    reason: { ...reasonMeta, reasons: scored.reasons ?? [] },
  });
  // History failure is logged in the return value rather than thrown — the
  // score write already succeeded and is the source of truth; losing the
  // audit trail entry is a real problem worth surfacing, but not one that
  // should make the caller think the enrichment itself failed.
  const historyFailed = !!histErr;

  // Hash-chained evidence event, written to the ONE evidence_events table
  // (also used by the standalone Python validator — see standalone
  // validator's evidence_ledger.py). An earlier version of this addition
  // wrote to a second table (twincities_evidence_events) with unpopulated
  // hash-chain columns; consolidated here so there's exactly one evidence
  // ledger, not two silently diverging ones.
  let evidenceEventFailed = false;
  try {
    const claimValue = { ...evidencePatch };
    delete claimValue.permitChecked;
    const contentHash = sha256Hex(JSON.stringify(sortKeys(claimValue)));
    const { data: prior } = await supabase
      .from("evidence_events")
      .select("event_hash")
      .eq("lead_id", leadRow.id)
      .eq("claim_type", changedBy)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const previousEventHash = prior?.event_hash ?? null;
    const eventHash = sha256Hex((previousEventHash || "") + contentHash);

    const { error: evErr } = await supabase.from("evidence_events").insert({
      lead_id: leadRow.id,
      claim_type: changedBy,
      claim_value: claimValue,
      source_type: changedBy,
      source_locator: reasonMeta?.source || null,
      confidence: scored.confidenceScore ?? null,
      crawler_id: reasonMeta?.workerId || changedBy,
      content_hash: contentHash,
      previous_event_hash: previousEventHash,
      event_hash: eventHash,
    });
    evidenceEventFailed = !!evErr;
  } catch {
    evidenceEventFailed = true;
  }

  return { before, after, delta: Math.round((after - before) * 100) / 100, scored, dbPatch, historyFailed, evidenceEventFailed };
}

function sha256Hex(input) {
  return crypto.createHash("sha256").update(input, "utf8").digest("hex");
}

function sortKeys(obj) {
  if (obj === null || typeof obj !== "object" || Array.isArray(obj)) return obj;
  return Object.keys(obj).sort().reduce((acc, k) => { acc[k] = sortKeys(obj[k]); return acc; }, {});
}
