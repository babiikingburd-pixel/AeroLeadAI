import { leadDecay, opportunityWindow } from "./leadDecay";
import { missionEconomics } from "./missionEconomics";

export function buildFutureOps(property={}, context={}, mission={queue:[]}) {
  const decay = leadDecay(property, context);
  const window = opportunityWindow(property, context);
  const economics = missionEconomics(mission.queue || [], property);
  const contradictions = mission.jury?.contradictions || [];
  const unknowns = [];
  if(!(context.images||[]).length) unknowns.push("Professional property imagery");
  if(!(context.outcomes||[]).length) unknowns.push("Field outcome");
  if(!(context.timeline||[]).length) unknowns.push("Historical property timeline");
  if(Number(property.confidence_score ?? property.confidence ?? 0)<60) unknowns.push("High-confidence evidence");
  return {
    leadDecay: decay,
    opportunityWindow: window,
    economics,
    unknowns,
    contradictions,
    actionClass: contradictions.length ? "VERIFY" : window.window==="NOW" && economics.recommendation!=="HOLD" ? "ACT" : "RESEARCH",
    explanation: contradictions.length
      ? "Resolve contradictions before promotion."
      : window.window==="NOW"
        ? "Evidence is current enough for immediate contractor action."
        : "Keep researching or watch until timing/evidence improves."
  };
}
