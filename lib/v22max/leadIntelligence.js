export const V22MAX_VERSION="2.3.1-GATEKEEPER-IMMEDIATE";
const n=(v,f=0)=>Number.isFinite(Number(v))?Number(v):f,c=x=>Math.max(0,Math.min(1,x));
const norm=(v,min,max)=>max<=min?.5:c((n(v)-min)/(max-min));
const terminal=s=>["verified","none_found","unavailable","reviewed","graded"].includes(String(s||"").toLowerCase());
export function evidenceState(r={}){
  const permit=terminal(r.permit_evidence_status)?String(r.permit_evidence_status).toLowerCase():"collecting";
  const assessor=(r.year_built||r.assessed_value)?"verified":terminal(r.value_evidence_status)?String(r.value_evidence_status).toLowerCase():"collecting";
  const storm=terminal(r.storm_evidence_status)?String(r.storm_evidence_status).toLowerCase():(r.storm_evidence||r.weather_evidence)?"verified":"collecting";
  const imagery=(r.image_review_status==="graded"||r.image_evidence_status==="usable"||r.roof_visual_score!=null)?"verified":r.image_evidence_status==="fetched"?"fetched":"collecting";
  const lanes={permit,assessor,storm,imagery};
  const complete=Object.values(lanes).every(x=>x!=="collecting"&&x!=="fetched");
  const verified=Object.values(lanes).filter(x=>["verified","none_found","unavailable"].includes(x)).length;
  return{lanes,collection_status:complete?"complete":verified?"partially-verified":"collecting",collection_complete:complete};
}
const complete=r=>{const s=evidenceState(r);return Object.values(s.lanes).filter(x=>x!=="collecting"&&x!=="fetched").length/4};
const storm=r=>/(hail|wind|severe|storm|damage|tornado|derecho)/.test(JSON.stringify(r.storm_evidence||r.weather_evidence||{}).toLowerCase())?1:0;
const age=r=>{const t=Date.parse(r.evidence_cycle_at||r.updated_at||r.created_at||"");return Number.isFinite(t)?Math.max(0,Math.floor((Date.now()-t)/86400000)):null};
const fresh=(r,h=45)=>{const a=age(r);return a===null?.6:c(Math.pow(.5,a/h))};
const propertyAge=r=>r.year_built?Math.max(0,new Date().getFullYear()-n(r.year_built)):null;
const signature=r=>{
  const ageSignal=propertyAge(r)==null?.45:c((propertyAge(r)-12)/38);
  const noRecentPermit=r.permit_within_10y===false?1:r.permit_within_10y===true?0:.5;
  const visual=norm(r.roof_visual_score??r.image_damage_score,0,100),base=norm(r.priority_score,0,100),weather=storm(r),value=norm(r.assessed_value,0,1000000);
  return c(base*.34+ageSignal*.18+noRecentPermit*.16+visual*.14+weather*.10+value*.08);
};
const contradictionPenalty=r=>{let p=0;if(r.permit_within_10y===true)p+=.18;if(n(r.roof_visual_score,-1)>=0&&n(r.roof_visual_score)<25)p+=.12;if(propertyAge(r)!=null&&propertyAge(r)<10)p+=.10;if(String(r.review_status||"").toLowerCase()==="disproved")p+=.35;return c(p)};
const score=r=>Math.round(c(signature(r)*.70+norm(r.evidence_score,0,100)*.10+norm(r.validation_score,0,100)*.08+complete(r)*.12-contradictionPenalty(r))*fresh(r)*100);
const win=(s,f)=>s>=70&&f>=.5?"NOW":s>=55?"0-3 MONTHS":s>=40?"3-6 MONTHS":s>=25?"6-12 MONTHS":"WATCH";
const stage=(r,state)=>{if(r.crm_status||r.contacted_at||r.status)return"ENGAGED";if(state.collection_complete&&n(r.validation_score)>=60)return"SALES-READY";if(state.collection_status==="partially-verified")return"QUALIFYING";return"DISCOVERED"};
const action=(r,e)=>e.collection_status==="collecting"?"Crawler network is validating this lead now — it remains ranked while evidence arrives.":e.lanes.imagery!=="verified"?"Imagery acquired; visual verification is the next certification lane.":!r.year_built?"Resolve assessor/year-built evidence.":!terminal(r.permit_evidence_status)?"Finish permit cross-check.":e.lifecycle_stage==="SALES-READY"?"Route to contractor for inspection booking.":"Keep ranked and re-score whenever new evidence arrives.";
export function crawlerPlan(r={},state=evidenceState(r)){
  const jobs=[];
  if(state.lanes.permit==="collecting")jobs.push({lane:"permit",priority:100,objective:"Search permit history; confirm recent roof/building work or establish no-record evidence."});
  if(state.lanes.assessor==="collecting")jobs.push({lane:"assessor",priority:95,objective:"Resolve year built, parcel class, assessed value and ownership/property facts."});
  if(state.lanes.imagery!=="verified")jobs.push({lane:"imagery",priority:90,objective:"Acquire street/satellite/property imagery and grade roof, tree, debris and visible damage signatures."});
  if(state.lanes.storm==="collecting")jobs.push({lane:"storm",priority:85,objective:"Cross-check hail, wind, tornado and severe-weather history at the property."});
  jobs.push({lane:"cross-check",priority:80,objective:"Search corroborating public-web evidence and contradictions; re-score on every material finding."});
  return jobs;
}
export function enrichLead(r={}){
  const state=evidenceState(r),f=fresh(r),s=score(r),sig=Math.round(signature(r)*100),pen=Math.round(contradictionPenalty(r)*100),certified=state.collection_complete&&n(r.validation_score)>=60;
  const e={opportunity_score:s,signature_score:sig,certified_score:certified?s:null,score_status:certified?"CERTIFIED":"PROVISIONAL",contradiction_penalty:pen,opportunity_window:win(s,f),freshness:Number(f.toFixed(4)),age_days:age(r),property_age:propertyAge(r),evidence_completeness:Number(complete(r).toFixed(4)),...state,storm_signal:storm(r)};
  e.lifecycle_stage=stage(r,e);e.crawler_jobs=crawlerPlan(r,e);e.crawler_job_count=e.crawler_jobs.length;return{...r,...e,next_action:action(r,e)};
}
export function scorecard(rows=[],stats=null,o={}){
  const e=rows.map(enrichLead),ranked=[...e].sort((a,b)=>b.opportunity_score-a.opportunity_score||b.signature_score-a.signature_score||b.evidence_completeness-a.evidence_completeness),avg=k=>e.length?Number((e.reduce((a,x)=>a+n(x[k]),0)/e.length).toFixed(4)):0,w={};
  e.forEach(x=>w[x.opportunity_window]=(w[x.opportunity_window]||0)+1);
  return{total:e.length,avg_opportunity_score:avg("opportunity_score"),avg_signature_score:avg("signature_score"),avg_freshness:avg("freshness"),avg_evidence_completeness:avg("evidence_completeness"),windows:w,sales_ready:e.filter(x=>x.lifecycle_stage==="SALES-READY").length,collecting:e.filter(x=>!x.collection_complete).length,verified:e.filter(x=>x.collection_complete).length,certified:e.filter(x=>x.score_status==="CERTIFIED").length,storm_flagged:e.filter(x=>x.storm_signal).length,crawler_jobs:e.reduce((a,x)=>a+x.crawler_job_count,0),ranked:ranked.slice(0,Math.min(Number(o.rankedLimit||500),500)),top:ranked.slice(0,10)};
}
