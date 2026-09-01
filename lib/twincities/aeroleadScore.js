const clamp100 = (value) => Math.max(0, Math.min(100, Number(value) || 0));

export const AEROLEAD_SCORE_VERSION = "aerolead-native-1.0";

export function evidenceCompleteness(sourceStatus = {}) {
  const lanes = ["permit", "storm", "assessor", "imagery"];
  const complete = lanes.filter((lane) => sourceStatus?.[lane] === true).length;
  return Math.round((complete / lanes.length) * 10000) / 100;
}

export function calculateAeroLeadScore({ priorityScore, evidenceConfidence, sourceStatus }) {
  const priority = clamp100(priorityScore);
  const confidence = clamp100(evidenceConfidence);
  const completeness = evidenceCompleteness(sourceStatus);

  const priorityContribution = priority * 0.60;
  const confidenceContribution = confidence * 0.20;
  const completenessContribution = completeness * 0.20;
  const score = Math.round(clamp100(priorityContribution + confidenceContribution + completenessContribution) * 100) / 100;

  return {
    version: AEROLEAD_SCORE_VERSION,
    score,
    components: {
      priority: { raw: priority, weight: 0.60, contribution: Math.round(priorityContribution * 100) / 100 },
      evidenceConfidence: { raw: confidence, weight: 0.20, contribution: Math.round(confidenceContribution * 100) / 100 },
      evidenceCompleteness: { raw: completeness, weight: 0.20, contribution: Math.round(completenessContribution * 100) / 100 },
    },
    missingEvidence: ["permit", "storm", "assessor", "imagery"].filter((lane) => sourceStatus?.[lane] !== true),
  };
}
