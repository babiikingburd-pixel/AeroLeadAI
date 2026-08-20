import { EVIDENCE_TWIN_VERSION, rankEvidenceTwins } from "./evidenceTwin.mjs";

const DEFAULT_SCAN_LIMIT = 1500;
const WRITE_BATCH_SIZE = 200;
const IMAGE_BATCH_SIZE = 200;

function groupByProperty(rows = []) {
  return rows.reduce((grouped, row) => {
    const id = String(row.property_id || "");
    if (!id) return grouped;
    (grouped[id] ||= []).push(row);
    return grouped;
  }, {});
}

async function fetchImages(supabase, ids) {
  const rows = [];
  for (let index = 0; index < ids.length; index += IMAGE_BATCH_SIZE) {
    const batch = ids.slice(index, index + IMAGE_BATCH_SIZE);
    const { data, error } = await supabase
      .from("property_images")
      .select("property_id,provider,view,image_kind,storage_path,quality_score,evidence_status,capture_date,fetched_at,content_hash")
      .in("property_id", batch)
      .order("fetched_at", { ascending: false });
    if (error) {
      // Scoring remains useful while a fresh project's image table is empty or
      // before the compact imagery migration has been applied.
      console.warn("[lite-score-refresh] imagery metadata unavailable", error.message);
      return {};
    }
    rows.push(...(data || []));
  }
  return groupByProperty(rows);
}

export async function refreshLiteLeaderboard(supabase, options = {}) {
  const scanLimit = Math.min(Math.max(Number(options.scanLimit) || DEFAULT_SCAN_LIMIT, 500), 5000);
  const { data: rows, error: rowsError } = await supabase
    .from("batch_leads")
    .select("*")
    .neq("review_status", "rejected")
    .order("priority_score", { ascending: false, nullsFirst: false })
    .limit(scanLimit);

  if (rowsError) throw new Error(`Lite score source query failed: ${rowsError.message}`);
  const ids = (rows || []).map((row) => String(row.id)).filter(Boolean);
  const imagesById = await fetchImages(supabase, ids);
  const ranked = rankEvidenceTwins(rows || [], { imagesById });
  const scoredAt = new Date().toISOString();
  const payload = ranked.map((row) => ({
    property_id: String(row.id),
    score_version: EVIDENCE_TWIN_VERSION,
    lite_rank: row.liteRank,
    lite_tier: row.liteTier,
    selection_track: row.selectionTrack,
    opportunity_score: row.evidenceTwin.opportunityScore,
    evidence_confidence: row.evidenceTwin.evidenceConfidence,
    contractor_value_score: row.evidenceTwin.contractorValueScore,
    rank_score: row.evidenceTwin.rankScore,
    score_status: row.evidenceTwin.scoreStatus,
    classification: row.evidenceTwin.classification,
    evidence_summary: row.evidenceTwin.evidenceSummary,
    score_breakdown: row.evidenceTwin.breakdown,
    penalties: row.evidenceTwin.penalties,
    next_evidence_plan: row.evidenceTwin.evidencePlan,
    scored_at: scoredAt,
  }));

  const { data: removed, error: beginError } = await supabase.rpc("lite_begin_score_refresh", {
    p_score_version: EVIDENCE_TWIN_VERSION,
  });
  if (beginError) throw new Error(`Lite score refresh boundary failed: ${beginError.message}`);

  let applied = 0;
  for (let index = 0; index < payload.length; index += WRITE_BATCH_SIZE) {
    const batch = payload.slice(index, index + WRITE_BATCH_SIZE);
    const { data, error } = await supabase.rpc("lite_apply_scores", { p_scores: batch });
    if (error) throw new Error(`Lite score write failed: ${error.message}`);
    applied += Number(data) || batch.length;
  }

  const { data: sync, error: syncError } = await supabase.rpc("lite_sync_top500_slots");
  if (syncError) throw new Error(`Lite Top-500 slot sync failed: ${syncError.message}`);
  const { data: staleTasksCancelled, error: reconcileError } = await supabase.rpc("lite_cancel_stale_top500_tasks");
  if (reconcileError) throw new Error(`Lite crawler reconciliation failed: ${reconcileError.message}`);
  const { data: retention, error: retentionError } = await supabase.rpc("lite_prune_compact_data");
  if (retentionError) throw new Error(`Lite retention pass failed: ${retentionError.message}`);

  return {
    ok: true,
    version: EVIDENCE_TWIN_VERSION,
    scanned: rows?.length || 0,
    eligible: ranked.length,
    previousScoresRemoved: Number(removed) || 0,
    applied,
    top20: Math.min(20, ranked.length),
    top100: Math.min(100, ranked.length),
    top500: Math.min(500, ranked.length),
    slotSync: sync,
    staleTasksCancelled: Number(staleTasksCancelled) || 0,
    retention,
    scoredAt,
  };
}
