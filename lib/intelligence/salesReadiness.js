const clamp=(x,a=0,b=100)=>Math.max(a,Math.min(b,Number(x)||0));
export function salesReadiness(property={}){
  const opportunity=clamp(property.opportunity_score ?? property.opportunityScore ?? property.priority_score);
  const confidence=clamp(property.confidence_score ?? property.confidenceScore ?? property.confidence);
  const evidence=clamp(property.evidence_score ?? property.evidenceScore);
  const hasCoords=Number.isFinite(Number(property.lat))&&Number.isFinite(Number(property.lon));
  const stale=property.evidence_stale===true || property.stale===true;
  const conflict=property.evidence_conflict===true || property.conflict===true;
  const recentPermit=property.permit_within_10y===true;
  let score=opportunity*.42+confidence*.28+evidence*.2+(hasCoords?5:0)+(property.contactable?5:0);
  if(stale) score-=12; if(conflict) score-=10; if(recentPermit) score-=15;
  score=Math.round(clamp(score));
  const band=score>=80?'SEND NOW':score>=65?'REVIEW THEN SEND':score>=45?'RESEARCH':'HOLD';
  return {score,band,reasons:[
    `Opportunity contributes ${Math.round(opportunity*.42)} points`,
    `Confidence contributes ${Math.round(confidence*.28)} points`,
    `Evidence contributes ${Math.round(evidence*.2)} points`,
    hasCoords?'Property is field-routable':'Coordinates missing',
    stale?'Evidence is stale':null,
    conflict?'Evidence conflict needs resolution':null,
    recentPermit?'Recent permit reduces replacement urgency':null,
  ].filter(Boolean)};
}
