const num=(v)=>Number.isFinite(Number(v))?Number(v):0;
export function runCriticJury(property={}, context={}){
  const opportunity=num(property.opportunity_score ?? property.opportunityScore ?? property.priority_score);
  const confidence=num(property.confidence_score ?? property.confidenceScore ?? property.confidence);
  const evidence=num(property.evidence_score ?? property.evidenceScore);
  const images=context.images?.length ?? property.images?.length ?? 0;
  const outcomes=context.outcomes?.length ?? 0;
  const contradictions=[];
  if(opportunity>=80 && confidence<55) contradictions.push('High opportunity score is not supported by equally strong confidence.');
  if(opportunity>=80 && evidence<50) contradictions.push('High opportunity score is running ahead of evidence completeness.');
  if(images===0) contradictions.push('No imagery is attached to the decision record.');
  if(property.permit_within_10y) contradictions.push('A recent permit may contradict an older-roof hypothesis.');
  if(property.evidence_stale) contradictions.push('Some evidence is marked stale.');

  const agents=[
    {name:'Opportunity Analyst',vote:opportunity>=70?'PROMOTE':'HOLD',confidence:Math.round((opportunity+evidence)/2)},
    {name:'Evidence Critic',vote:contradictions.length===0&&evidence>=55?'PROMOTE':'RESEARCH',confidence:Math.max(35,Math.round(evidence))},
    {name:'Field Value Analyst',vote:confidence>=65&&opportunity>=65?'PROMOTE':'REVIEW',confidence:Math.round((confidence+opportunity)/2)},
  ];
  const promote=agents.filter(a=>a.vote==='PROMOTE').length;
  const verdict=contradictions.length>=2?'RESEARCH':promote>=2?'PROMOTE':opportunity>=55?'HUMAN REVIEW':'HOLD';
  return {verdict,agents,contradictions,outcomeExamples:outcomes,rule:'Contradictions are surfaced, never averaged away.'};
}
