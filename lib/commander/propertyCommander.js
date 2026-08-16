import { buildFutureOps } from "../intelligence/futureOps";
import { salesReadiness } from "../intelligence/salesReadiness";
import { runCriticJury } from "../intelligence/criticJury";

const n=v=>Number.isFinite(Number(v))?Number(v):0;
export function buildPropertyMission(property={}, context={}){
  const readiness=salesReadiness(property);
  const jury=runCriticJury(property,context);
  const confidence=n(property.confidence_score ?? property.confidenceScore ?? property.confidence);
  const evidence=n(property.evidence_score ?? property.evidenceScore);
  const imageCount=context.images?.length ?? property.images?.length ?? 0;
  const jobs=[];
  const add=(type,priority,reason,costTier='FREE/LOW')=>jobs.push({type,priority,reason,costTier});

  if(imageCount===0) add('FETCH_EAGLEVIEW',100,'No professional imagery is attached.','PREMIUM');
  if(imageCount===1) add('FIND_HISTORICAL_IMAGE',82,'A second dated image unlocks change detection.','LOW/PREMIUM');
  if(confidence<60) add('CROSS_CHECK_EVIDENCE',92,'Confidence is below the promotion threshold.');
  if(evidence<60) add('FILL_EVIDENCE_GAPS',88,'Evidence completeness is below target.');
  if(jury.contradictions.length) add('RESOLVE_CONTRADICTIONS',96,`${jury.contradictions.length} contradiction(s) require resolution.`);
  if(property.lat && property.lon) add('NEIGHBORHOOD_XRAY',58,'Property can be compared with its surrounding opportunity cluster.','LOW');
  if(readiness.score>=75 && jury.verdict==='PROMOTE') add('FIELD_REVIEW',86,'Property is strong enough to justify contractor attention.','HUMAN');
  if(context.outcomes?.length===0) add('CAPTURE_OUTCOME',45,'No field outcome exists yet; closing the loop improves calibration.','HUMAN');

  jobs.sort((a,b)=>b.priority-a.priority);
  const maxPremium=Number(process.env.AEROLEAD_PREMIUM_CALLS_PER_PROPERTY || 2);
  let premiumUsed=0;
  const approved=jobs.filter(j=>{
    if(j.costTier!=='PREMIUM') return true;
    if(premiumUsed>=maxPremium) return false;
    premiumUsed+=1; return true;
  });

  const baseMission = {
    missionStatus: jury.verdict,
    salesReadiness: readiness,
    jury,
    nextAction: approved[0] || {type:'HOLD',priority:0,reason:'No additional action is currently justified.'},
    queue: approved,
    budget: {premiumCallLimit:maxPremium,premiumCallsPlanned:premiumUsed},
  };
  return {...baseMission, futureOps: buildFutureOps(property, context, baseMission)};
}
