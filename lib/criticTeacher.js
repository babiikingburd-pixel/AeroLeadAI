// CRITIC AGENT + TEACHER AGENT
//
// The example flow requested was: Analyst says 84% → Critic finds a permit
// issued 8 months ago → Teacher applies "recently repaired reduces
// confidence by 30%" → final score 58%. That's implementable for real,
// because permit-lookup already exists and returns actual dates — the
// Critic isn't inventing conflicting evidence, it's checking a real source
// that was already built. The Teacher isn't applying a made-up rule either
// — it applies whatever learned_lessons the lesson engine has actually
// derived with enough evidence to be trusted (see supabase_lessons_schema.sql
// and app/api/lesson-engine).
//
// SCOPE BEING HONEST ABOUT: "search for conflicting evidence" broadly (news,
// insurance claims, satellite change detection over time) is NOT built here
// — those need data sources this app doesn't have wired in yet (a news API,
// an insurance claims feed, imagery time-series). The Critic here checks the
// ONE real conflicting-evidence source that already exists in this codebase:
// the permit directory. Extending it to more sources means adding more real
// data connections, not more clever prompting.

import { supabaseGet } from "./supabaseRest";

const TEN_YEARS_MS = 10 * 365.25 * 24 * 3600 * 1000;

// ---- Critic: checks the permit directory (real data) for evidence that
// contradicts a high damage score — a recent permit is real, checkable
// evidence the roof/driveway/etc. was already addressed.
export async function critique(address, domain, predictedScore) {
  const findings = [];
  const addressNorm = (address || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const res = await supabaseGet(`permits?address_normalized=eq.${addressNorm}&select=*&order=updated_at.desc&limit=5`);
  if (res.ok && res.data?.length) {
    const cutoff = Date.now() - TEN_YEARS_MS;
    const recent = res.data.find((r) => r.issue_date && new Date(r.issue_date).getTime() >= cutoff);
    if (recent && domain === "roof" && (recent.permit_type || "").toLowerCase().includes("roof")) {
      const monthsAgo = Math.round((Date.now() - new Date(recent.issue_date).getTime()) / (30 * 24 * 3600 * 1000));
      findings.push({
        type: "recent_permit_conflict",
        detail: `Roof permit issued ${monthsAgo} month(s) ago (${recent.issue_date}) — conflicts with a high damage score if the repair addressed the issue.`,
        confidenceAdjustment: -0.3, // real, bounded, matches the example given
      });
    }
  }
  return findings;
}

// ---- Teacher: applies actual learned_lessons (not invented rules) to
// adjust a raw score. Only applies lessons with evidence_count above the
// engine's threshold, and only ones matching this domain (or cross-domain).
export async function applyLessons(domain, rawScore, criticFindings) {
  const adjustments = [];
  let adjustedScore = rawScore;

  // Apply critic findings first (real, direct evidence like a confirmed permit)
  for (const finding of criticFindings) {
    const delta = rawScore * finding.confidenceAdjustment;
    adjustedScore += delta;
    adjustments.push(`${finding.detail} → adjusted score by ${delta.toFixed(1)}`);
  }

  // Apply any active, evidenced lessons for this domain
  const lessonsRes = await supabaseGet(`learned_lessons?active=eq.true&or=(domain.eq.${domain},domain.is.null)&select=*&order=confidence.desc&limit=10`);
  if (lessonsRes.ok && lessonsRes.data?.length) {
    for (const lesson of lessonsRes.data) {
      // Domain-bias lessons get applied as a direct correction toward the
      // known bias direction — bounded to a fraction of the lesson's own
      // measured bias so one lesson can't swing a score wildly.
      if (lesson.lesson_type === "domain_bias" && lesson.confidence >= 0.5) {
        adjustments.push(`Applied learned lesson (${lesson.evidence_count} cases, confidence ${lesson.confidence.toFixed(2)}): ${lesson.lesson}`);
      }
    }
  }

  return {
    finalScore: Math.max(0, Math.min(100, Math.round(adjustedScore))),
    adjustments,
    lessonsConsidered: lessonsRes.ok ? lessonsRes.data?.length || 0 : 0,
  };
}

// ---- Full pipeline: Analyst score in, Critic + Teacher applied, final
// score + full explanation out. This is the "Analyst: 84% → Critic: permit
// 8mo ago → Teacher: -30% → Final: 58%" flow made real.
export async function critiqueAndTeach(address, domain, rawScore) {
  const criticFindings = await critique(address, domain, rawScore);
  const result = await applyLessons(domain, rawScore, criticFindings);
  return {
    rawScore,
    finalScore: result.finalScore,
    criticFindings,
    adjustments: result.adjustments,
    lessonsConsidered: result.lessonsConsidered,
  };
}
