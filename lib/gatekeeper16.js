import crypto from "node:crypto";

export const APEX16_VERSION = "16.0";
const MEDIUM = 0.60;
const HIGH = 0.85;

function freshness(capturedAt){
  if(!capturedAt) return 0.45;
  const t=Date.parse(capturedAt); if(!Number.isFinite(t)) return 0.35;
  const age=Math.max(0,(Date.now()-t)/86400000);
  return Math.max(0.25,Math.exp(-age/365));
}
function stable(v){ try{return JSON.stringify(v,Object.keys(v||{}).sort())}catch{return String(v)} }

export function evaluateGate(claim,evidence=[],requiredSources=[]){
  const required=new Set(requiredSources);
  const verified=evidence.filter(e=>e?.verified);
  const groups=new Map();
  for(const e of verified){ const k=e.contradictionKey||e.source; if(!groups.has(k)) groups.set(k,new Set()); groups.get(k).add(stable(e.value)); }
  const contradictions=[...groups.values()].filter(s=>s.size>1).length;
  const present=new Set(evidence.map(e=>e?.source).filter(Boolean));
  const missing=[...required].filter(x=>!present.has(x)).sort();
  const weighted=verified.reduce((a,e)=>a+Math.max(0,Number(e.weight??1))*freshness(e.capturedAt),0);
  const total=evidence.reduce((a,e)=>a+Math.max(0,Number(e.weight??1)),0)||1;
  const confidence=Math.min(1,(weighted/total)*(1-Math.min(0.6,contradictions*0.15)));
  const reasons=[];
  if(!evidence.length) reasons.push("No evidence supplied.");
  if(!verified.length) reasons.push("No verified evidence supplied.");
  if(missing.length) reasons.push(`Required sources are missing: ${missing.join(", ")}`);
  if(contradictions) reasons.push(`${contradictions} contradiction group(s) require review.`);
  if(confidence<MEDIUM) reasons.push("Confidence is below the autonomous-action threshold.");
  if(!reasons.length) reasons.push("Evidence meets the current GateKeeper threshold.");
  let status="HOLD-FOR-VERIFICATION";
  if(verified.length && !missing.length && !contradictions && confidence>=MEDIUM) status=confidence>=HIGH?"VERIFIED-ACTIONABLE":"VERIFIED-WITH-CAUTION";
  const payload={claim,evidence,required:[...required].sort(),status,confidence:Number(confidence.toFixed(4))};
  return {...payload,evidenceCount:evidence.length,verifiedCount:verified.length,contradictionCount:contradictions,missing,reasons,fingerprint:crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex"),generatedAt:new Date().toISOString()};
}

export function evidenceFromLead(row={},images=[]){
  const e=[];
  if(row.address) e.push({source:"property-record",value:row.address,verified:true,weight:.7,capturedAt:row.updated_at||row.created_at});
  if(row.assessed_value) e.push({source:"assessor",value:row.assessed_value,verified:row.value_evidence_status==="verified"||Boolean(row.assessed_value),weight:1,contradictionKey:"assessed_value",capturedAt:row.value_checked_at||row.updated_at});
  if(row.permit_evidence_status && row.permit_evidence_status!=="unknown") e.push({source:"permit",value:{status:row.permit_evidence_status,history:row.permit_history_count},verified:Boolean(row.permit_checked_at),weight:.9,contradictionKey:"permit",capturedAt:row.permit_checked_at});
  if(row.storm_evidence_status && row.storm_evidence_status!=="unknown") e.push({source:"storm",value:row.storm_evidence||row.weather_evidence||row.storm_evidence_status,verified:Boolean(row.storm_checked_at||row.weather_checked_at),weight:.9,contradictionKey:"storm",capturedAt:row.storm_checked_at||row.weather_checked_at});
  if(row.roof_visual_score!=null || row.image_damage_score!=null) e.push({source:"visual-analysis",value:{roof:row.roof_visual_score,damage:row.image_damage_score,quality:row.evidence_quality_score},verified:row.image_evidence_status==="usable"||row.image_review_status==="graded",weight:1,contradictionKey:"visual",capturedAt:row.image_fetched_at||row.updated_at});
  for(const img of images.slice(0,10)) e.push({source:img.provider||"imagery",value:{url:Boolean(img.image_url||img.enhanced_image_url||img.original_image_url),damage:img.damage_score,view:img.view},verified:Boolean(img.image_url||img.enhanced_image_url||img.original_image_url),weight:1,contradictionKey:"imagery",capturedAt:img.capture_date||img.fetched_at});
  return e;
}

export function evaluateLead(row,images=[]){
  return evaluateGate(`Property opportunity assessment for ${row?.address||row?.id||"unknown"}`,evidenceFromLead(row,images),["property-record"]);
}
