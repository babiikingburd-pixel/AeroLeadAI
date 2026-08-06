// This formula is implemented twice: here, and in SQL as
// apex10_rebuild_leaderboard() (supabase/migrations/20260805b_*.sql). Both
// write evidence_fusion_score / evidence_fusion_confidence /
// evidence_quality_score / challenger_score on batch_leads, so they must stay
// identical — they drifted once already and the leaderboard disagreed with
// itself depending on which path last touched a row. Change one, change both,
// and bump this version so the stored rows say which definition produced them.
export const FUSION_VERSION = "APEX10.0";

const clamp = (n, lo=0, hi=100) => Math.max(lo, Math.min(hi, Number(n) || 0));
const n = (v) => Number.isFinite(Number(v)) ? Number(v) : null;

export function fuseEvidence(row) {
  const permit = row.permit_evidence_status === "verified" || row.permit_evidence_status === "none_found";
  const assessor = row.value_evidence_status === "verified" || !!n(row.assessed_value);
  const storm = row.storm_evidence_status === "verified" ||
    row.hail_inches != null || row.wind_mph != null || row.storm_date != null;
  const imageReviewed = ["verified","adjudicated"].includes(row.image_review_status);
  const imageConfidence = clamp(row.image_review_confidence);
  const visibility = clamp(row.image_visibility_score);
  const visualDamage = clamp(row.image_damage_score);

  // Evidence quality measures coverage/reliability, not whether the property is good.
  const quality = clamp(
    (permit ? 20 : 0) +
    (assessor ? 20 : 0) +
    (storm ? 20 : 0) +
    (imageReviewed ? 25 : 0) +
    (imageReviewed ? Math.min(15, imageConfidence * 0.10 + visibility * 0.05) : 0)
  );

  // Positive signals are deliberately capped and require corroboration.
  const corroboration = [storm, imageReviewed, permit && row.permit_within_10y === true].filter(Boolean).length;
  const damageSignal = storm ? 25 : 0;
  const visualSignal = imageReviewed ? (visualDamage * Math.min(1, imageConfidence / 70) * 0.45) : 0;
  const maturitySignal = Number(row.priority_score) || 0;
  const fused = clamp(maturitySignal * 0.55 + damageSignal + visualSignal + (corroboration >= 2 ? 8 : 0));

  const confidence = clamp(
    quality * 0.65 +
    (corroboration >= 2 ? 20 : corroboration === 1 ? 10 : 0) +
    (imageReviewed ? imageConfidence * 0.15 : 0)
  );

  return {
    evidenceQuality: Math.round(quality * 100) / 100,
    evidenceFusionScore: Math.round(fused * 100) / 100,
    evidenceFusionConfidence: Math.round(confidence * 100) / 100,
    challengerScore: Math.round((fused * 0.75 + quality * 0.25) * 100) / 100,
    corroboration,
    reasons: { permit, assessor, storm, imageReviewed, imageConfidence, visibility, visualDamage, corroboration }
  };
}

export async function recordFusion(supabase, row, result, decision="scored") {
  await supabase.from("twincities_fusion_events").insert({
    lead_id: String(row.id),
    prior_score: row.evidence_fusion_score ?? row.priority_score ?? null,
    fused_score: result.evidenceFusionScore,
    confidence: result.evidenceFusionConfidence,
    evidence_quality: result.evidenceQuality,
    decision,
    reasons: result.reasons
  });
}
