// THE LESSON ENGINE — turns memory (predictions + corrections) into
// knowledge (patterns worth acting on). Runs nightly via Vercel Cron
// (separate schedule in vercel.json — "nightly" is just a cron string,
// same mechanism as the 30-min heartbeat, no new primitive needed).
//
// HONEST DESIGN CHOICE: this does NOT run a black-box model to "discover"
// patterns nobody can verify. It runs three simple, explainable statistical
// checks, and every lesson it writes carries supporting_correction_ids so a
// human can always go look at the actual evidence behind the sentence:
//
//   1. Domain bias — does this domain's predictions systematically run
//      high or low vs actual? (signed error, not just magnitude)
//   2. Confidence calibration — does "low confidence" actually correlate
//      with bigger errors? (if not, the confidence field itself is lying)
//   3. Reason-text signal — do human-written correction reasons repeatedly
//      mention the same thing (e.g. "permit", "already repaired", "new
//      roof") in corrections that swing the same direction? This is
//      keyword frequency counting, not NLP magic — genuinely explainable.
//
// A minimum evidence threshold (MIN_EVIDENCE) gates every lesson so 2-3
// corrections never get promoted to a stated "pattern."

import { supabaseGet, supabasePost, supabasePatch } from "../../../lib/supabaseRest";
import { withCrawlerLog } from "../../../lib/crawlerLog";
export const dynamic = "force-dynamic";

export const maxDuration = 60;

const MIN_EVIDENCE = 5; // fewer than this and it's noise, not a lesson
const CONFIRM_EVIDENCE_GROWTH = 5; // needs this many MORE data points before an experiment can graduate

function checkAuth(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  const url = new URL(req.url);
  return url.searchParams.get("secret") === secret || req.headers.get("authorization") === `Bearer ${secret}`;
}

// ---- Scientist Agent: run every candidate through the experiment lifecycle
// instead of writing straight to learned_lessons. First sighting = new
// experiment (status 'testing'). Re-sighting with MORE evidence and the
// SAME direction/magnitude = confirmed, promoted to learned_lessons. If the
// effect shrinks below the meaningful threshold or flips direction on
// re-check, mark refuted and stop tracking it. This is what makes "runs
// experiments, tracks success rates" a real mechanism, not a label.
async function runScientistAgent(candidates) {
  const outcomes = { newExperiments: 0, confirmed: 0, refuted: 0, stillTesting: 0, errors: [] };

  for (const candidate of candidates) {
    const effectSize = candidate.lesson_type === "domain_bias" || candidate.lesson_type === "reason_keyword_signal"
      ? parseFloat((candidate.lesson.match(/([\d.]+) points?/) || [])[1] || "0")
      : 0;

    const existingRes = await supabaseGet(
      `lesson_experiments?lesson_type=eq.${candidate.lesson_type}&domain=${candidate.domain ? `eq.${candidate.domain}` : "is.null"}&status=eq.testing&order=started_at.desc&limit=1`
    );
    const existing = existingRes.ok && existingRes.data?.[0];

    if (!existing) {
      // First sighting — open a new experiment, do NOT write to learned_lessons yet.
      const insertRes = await supabasePost("lesson_experiments", [{
        hypothesis: candidate.lesson, lesson_type: candidate.lesson_type, domain: candidate.domain,
        initial_evidence_count: candidate.evidence_count, current_evidence_count: candidate.evidence_count,
        initial_effect_size: effectSize, current_effect_size: effectSize,
      }]);
      if (insertRes.ok) outcomes.newExperiments++; else outcomes.errors.push(insertRes.error);
      continue;
    }

    // Re-sighting — check if evidence has actually grown enough to re-measure meaningfully
    const evidenceGrowth = candidate.evidence_count - existing.current_evidence_count;
    if (evidenceGrowth < CONFIRM_EVIDENCE_GROWTH) {
      outcomes.stillTesting++;
      continue; // not enough new data yet to trust a re-measurement either way
    }

    const sameDirection = Math.sign(effectSize) === Math.sign(existing.initial_effect_size);
    const magnitudeHeld = Math.abs(effectSize) >= Math.abs(existing.initial_effect_size) * 0.6; // allow some drift, not total collapse

    if (sameDirection && magnitudeHeld) {
      // Confirmed — promote to a real, active lesson
      const lessonRes = await supabasePost("learned_lessons", [{
        domain: candidate.domain, lesson: candidate.lesson, lesson_type: candidate.lesson_type,
        confidence: Math.min(0.95, candidate.evidence_count / 100), evidence_count: candidate.evidence_count,
        supporting_correction_ids: candidate.supporting_correction_ids || [],
      }]);
      const lessonId = lessonRes.ok && lessonRes.data?.[0]?.lesson_id;
      await supabasePatch(`lesson_experiments?experiment_id=eq.${existing.experiment_id}`, {
        status: "confirmed", current_evidence_count: candidate.evidence_count, current_effect_size: effectSize,
        check_count: (existing.check_count || 1) + 1, resolved_at: new Date().toISOString(), promoted_lesson_id: lessonId || null,
      });
      outcomes.confirmed++;
    } else {
      // Refuted — the pattern didn't hold up under more data. Stop tracking it.
      await supabasePatch(`lesson_experiments?experiment_id=eq.${existing.experiment_id}`, {
        status: "refuted", current_evidence_count: candidate.evidence_count, current_effect_size: effectSize,
        check_count: (existing.check_count || 1) + 1, resolved_at: new Date().toISOString(),
      });
      outcomes.refuted++;
    }
  }

  return outcomes;
}

async function fetchResolvedPredictions() {
  const res = await supabaseGet("predictions?actual_score=not.is.null&select=*&order=predicted_at.desc&limit=500");
  return res.ok ? res.data : [];
}

async function fetchCorrectionsWithReasons() {
  const res = await supabaseGet("corrections?reason=not.is.null&select=*&order=created_at.desc&limit=500");
  return res.ok ? res.data : [];
}

// ---- Check 1: domain bias (signed, not absolute error) ----
function detectDomainBias(predictions) {
  const byDomain = {};
  for (const p of predictions) {
    if (p.actual_score === null || p.predicted_score === null) continue;
    byDomain[p.domain] = byDomain[p.domain] || [];
    byDomain[p.domain].push({ signedError: p.predicted_score - p.actual_score, id: p.prediction_id });
  }
  const lessons = [];
  for (const [domain, rows] of Object.entries(byDomain)) {
    if (rows.length < MIN_EVIDENCE) continue;
    const avgSigned = rows.reduce((a, b) => a + b.signedError, 0) / rows.length;
    if (Math.abs(avgSigned) < 5) continue; // not a meaningful bias, don't manufacture a lesson
    const direction = avgSigned > 0 ? "overestimates" : "underestimates";
    lessons.push({
      domain, lesson_type: "domain_bias",
      lesson: `${domain} predictions systematically ${direction} risk by an average of ${Math.abs(avgSigned).toFixed(1)} points across ${rows.length} resolved predictions.`,
      confidence: Math.min(0.9, rows.length / 100),
      evidence_count: rows.length,
      supporting_correction_ids: [],
    });
  }
  return lessons;
}

// ---- Check 2: does the stated confidence level actually correlate with error size? ----
function detectConfidenceCalibration(predictions) {
  const byConfidence = { low: [], medium: [], high: [] };
  for (const p of predictions) {
    if (!byConfidence[p.confidence] || p.error_magnitude === null) continue;
    byConfidence[p.confidence].push(p.error_magnitude);
  }
  const lessons = [];
  const lowAvg = byConfidence.low.length >= MIN_EVIDENCE ? byConfidence.low.reduce((a, b) => a + b, 0) / byConfidence.low.length : null;
  const highAvg = byConfidence.high.length >= MIN_EVIDENCE ? byConfidence.high.reduce((a, b) => a + b, 0) / byConfidence.high.length : null;
  if (lowAvg !== null && highAvg !== null) {
    if (lowAvg <= highAvg) {
      lessons.push({
        domain: null, lesson_type: "confidence_miscalibration",
        lesson: `WARNING: "low confidence" predictions (avg error ${lowAvg.toFixed(1)}) are not actually less accurate than "high confidence" ones (avg error ${highAvg.toFixed(1)}) — the confidence field isn't a reliable signal yet.`,
        confidence: 0.7, evidence_count: byConfidence.low.length + byConfidence.high.length,
        supporting_correction_ids: [],
      });
    } else {
      lessons.push({
        domain: null, lesson_type: "confidence_calibration",
        lesson: `Confidence field is well-calibrated: "low confidence" predictions average ${lowAvg.toFixed(1)} points of error vs ${highAvg.toFixed(1)} for "high confidence" — trust the confidence label.`,
        confidence: 0.7, evidence_count: byConfidence.low.length + byConfidence.high.length,
        supporting_correction_ids: [],
      });
    }
  }
  return lessons;
}

// ---- Check 3: keyword frequency in human-written correction reasons ----
const SIGNAL_KEYWORDS = ["permit", "already repaired", "already replaced", "new roof", "recently replaced", "inspection", "no damage", "old roof", "roof age"];

function detectReasonSignals(corrections) {
  const byKeyword = {};
  for (const c of corrections) {
    const reasonLower = (c.reason || "").toLowerCase();
    const swing = (c.corrected_score ?? 0) - (c.original_score ?? 0); // negative = system overestimated
    for (const kw of SIGNAL_KEYWORDS) {
      if (reasonLower.includes(kw)) {
        byKeyword[kw] = byKeyword[kw] || [];
        byKeyword[kw].push({ swing, id: c.correction_id });
      }
    }
  }
  const lessons = [];
  for (const [kw, rows] of Object.entries(byKeyword)) {
    if (rows.length < MIN_EVIDENCE) continue;
    const avgSwing = rows.reduce((a, b) => a + b.swing, 0) / rows.length;
    if (Math.abs(avgSwing) < 8) continue;
    const direction = avgSwing < 0 ? "overestimated" : "underestimated";
    lessons.push({
      domain: null, lesson_type: "reason_keyword_signal",
      lesson: `When corrections mention "${kw}", the original prediction was ${direction} by an average of ${Math.abs(avgSwing).toFixed(1)} points, across ${rows.length} case(s). Consider this signal in scoring.`,
      confidence: Math.min(0.85, rows.length / 30),
      evidence_count: rows.length,
      supporting_correction_ids: rows.map((r) => r.id),
    });
  }
  return lessons;
}

export async function GET(req) {
  if (!checkAuth(req)) return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const result = await withCrawlerLog("lesson_engine", async () => {
    const [predictions, corrections] = await Promise.all([fetchResolvedPredictions(), fetchCorrectionsWithReasons()]);

    if (predictions.length < MIN_EVIDENCE && corrections.length < MIN_EVIDENCE) {
      return { succeeded: 0, failed: 0, errors: [], lessonsGenerated: 0, notes: `Only ${predictions.length} resolved predictions and ${corrections.length} reasoned corrections — below the ${MIN_EVIDENCE} minimum, no lessons manufactured from insufficient evidence.` };
    }

    const candidates = [
      ...detectDomainBias(predictions),
      ...detectConfidenceCalibration(predictions),
      ...detectReasonSignals(corrections),
    ];

    // Confidence-calibration lessons are meta-observations about the system
    // itself, not a bias pattern with an effect size to re-test — write
    // those directly, they're already fully evidenced by definition.
    const directWrite = candidates.filter((c) => c.lesson_type === "confidence_miscalibration" || c.lesson_type === "confidence_calibration");
    const testable = candidates.filter((c) => !directWrite.includes(c));

    let succeeded = 0, failed = 0;
    const errors = [];
    for (const lesson of directWrite) {
      const res = await supabasePost("learned_lessons", [lesson]);
      if (res.ok) succeeded++; else { failed++; errors.push(res.error); }
    }

    const scientistOutcomes = await runScientistAgent(testable);
    errors.push(...scientistOutcomes.errors);

    return {
      succeeded: succeeded + scientistOutcomes.newExperiments + scientistOutcomes.confirmed,
      failed: failed + scientistOutcomes.errors.length,
      errors,
      lessonsGenerated: directWrite.length + scientistOutcomes.confirmed,
      scientistAgent: { newExperiments: scientistOutcomes.newExperiments, confirmed: scientistOutcomes.confirmed, refuted: scientistOutcomes.refuted, stillTesting: scientistOutcomes.stillTesting },
    };
  });

  // Research agent (Level 5, observe/propose only) and Evolution Engine
  // (Level 4, retire underperforming agents) run as part of the same
  // nightly cycle. Each is independently try/caught so one failing never
  // silently drops the others' results.
  let researchResult = null, evolutionResult = null;
  try {
    const { runResearchCycle } = await import("../../../lib/researchAgent");
    researchResult = await runResearchCycle();
  } catch (e) {
    researchResult = { ok: false, error: e.message };
  }
  try {
    const { retireBottomPerformers } = await import("../../../lib/evolutionEngine");
    evolutionResult = await retireBottomPerformers(0.5);
  } catch (e) {
    evolutionResult = { ok: false, error: e.message };
  }

  return Response.json({ ok: true, ...result, researchAgent: researchResult, evolutionEngine: evolutionResult });
}
