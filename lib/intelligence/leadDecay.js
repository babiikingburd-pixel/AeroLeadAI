const num = (v, d=0) => Number.isFinite(Number(v)) ? Number(v) : d;
const daysBetween = (a,b=Date.now()) => {
  const t = new Date(a || 0).getTime();
  return t ? Math.max(0, (b-t)/86400000) : 9999;
};

export function evidenceFreshness(property={}, context={}) {
  const dates = [
    property.updated_at, property.last_enriched_at, property.imagery_date,
    ...(context.images || []).map(x => x.captured_at || x.captureDate || x.date),
    ...(context.timeline || []).map(x => x.recorded_at || x.created_at || x.date)
  ].filter(Boolean);
  const newest = dates.map(d => new Date(d).getTime()).filter(Number.isFinite).sort((a,b)=>b-a)[0];
  const ageDays = newest ? Math.round((Date.now()-newest)/86400000) : null;
  const confidence = num(property.confidence_score ?? property.confidenceScore ?? property.confidence);
  let freshness = ageDays == null ? 25 : Math.max(0, 100 - ageDays * 0.18);
  freshness = Math.round(Math.min(100, freshness * .7 + confidence * .3));
  return { freshness, ageDays, status: freshness >= 75 ? "FRESH" : freshness >= 45 ? "AGING" : "STALE" };
}

export function leadDecay(property={}, context={}) {
  const base = num(property.opportunity_score ?? property.score ?? property.priority_score);
  const f = evidenceFreshness(property, context);
  const outcome = (context.outcomes || [])[0];
  const terminal = outcome && ["sold","completed","invalid","do_not_contact"].includes(String(outcome.status || outcome.outcome || "").toLowerCase());
  const decay = terminal ? 100 : Math.max(0, (100-f.freshness) * .45);
  const adjusted = Math.max(0, Math.round(base - decay));
  return { baseScore: base, adjustedScore: adjusted, decayPenalty: Math.round(decay), ...f, terminal: !!terminal };
}

export function opportunityWindow(property={}, context={}) {
  const d = leadDecay(property, context);
  const storm = num(property.storm_score ?? property.stormScore);
  const readiness = num(property.sales_readiness ?? property.salesReadiness);
  const score = Math.max(d.adjustedScore, readiness);
  let window = "WATCH";
  if (score >= 82 && d.freshness >= 55) window = "NOW";
  else if (score >= 68 || storm >= 70) window = "0-3 MONTHS";
  else if (score >= 52) window = "3-6 MONTHS";
  else if (score >= 38) window = "6-12 MONTHS";
  return { window, score: Math.round(score), freshness: d.freshness, rationale:
    window === "NOW" ? "Strong current opportunity with usable evidence." :
    window === "WATCH" ? "Evidence or opportunity strength is not high enough for field action." :
    "Promising property, but timing or evidence strength does not justify immediate field action."
  };
}
