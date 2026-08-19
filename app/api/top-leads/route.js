import { supabaseServer } from "../../../lib/supabaseServer";
import { TC_COUNTIES, FAST_SCORE_FIELDS, scoreRow } from "../../../lib/twincities/fastCycle";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const TIER_CAPS = { review: 100, candidates: 500, contractor: 20 };
const PAGE_SIZE = 1000;
const MAX_SCAN_PAGES = 4;

function addressKey(r){return [r.address||"",r.city||"",r.county||""].join("|").toLowerCase().replace(/[^a-z0-9|]/g,"")}
function looksLikeUnitAddress(addr=""){return /\b(apt|apartment|unit|suite|ste|#)\s*[a-z0-9-]+\b/i.test(String(addr))}
function residentialEnough(r){
  const cls=String(r.property_class||"").toLowerCase();
  const addr=String(r.address||"").toLowerCase();
  const blocked=["apartment","apartments","multifamily","multi-family","multi family","commercial","industrial","office","retail","hotel","school","church","condo building","duplex","triplex","fourplex","townhome complex"];
  if(blocked.some(x=>cls.includes(x)||addr.includes(x))) return false;
  if(looksLikeUnitAddress(addr)) return false;
  return !!r.address && r.lat!=null && r.lon!=null;
}
function singleFamilySignal(r){
  const cls=String(r.property_class||"").toLowerCase();
  if(/\b(single[\s-]?family|sfr|detached|residential 1|one family|1 family)\b/i.test(cls)) return 2;
  if(/\b(residential|homestead|house)\b/i.test(cls)) return 1;
  return 0;
}
function freeSatelliteFallback(lat,lon){const d=.0012;return `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export?bbox=${lon-d},${lat-d},${lon+d},${lat+d}&bboxSR=4326&imageSR=4326&size=900,900&format=jpg&f=image`}
function streetViewUrl(r){
  if(r.lat!=null&&r.lon!=null)return `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${Number(r.lat)},${Number(r.lon)}`;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${r.address||""}, ${r.city||""}, MN`)}`;
}
function rankRows(rows){
  const best=new Map();
  for(const raw of rows||[]){
    if(!residentialEnough(raw))continue;
    const scored=scoreRow(raw);
    const score=Number(scored.priorityScore??raw.priority_score??0),confidence=Number(scored.confidenceScore??raw.confidence_score??0);
    if(!scored.entered&&score<=0)continue;
    const row={...raw,...scored,priorityScore:score,confidenceScore:confidence,singleFamilySignal:singleFamilySignal(raw)};
    const key=addressKey(row)||String(row.id),prior=best.get(key);
    if(!prior||score>prior.priorityScore||(score===prior.priorityScore&&confidence>prior.confidenceScore))best.set(key,row);
  }
  return [...best.values()].sort((a,b)=>b.singleFamilySignal-a.singleFamilySignal||b.priorityScore-a.priorityScore||b.confidenceScore-a.confidenceScore);
}

async function fetchCandidateRows(supabase){
  const pages=Array.from({length:MAX_SCAN_PAGES},(_,page)=>{
    const from=page*PAGE_SIZE,to=from+PAGE_SIZE-1;
    return supabase.from("batch_leads").select(FAST_SCORE_FIELDS)
      .in("county",TC_COUNTIES).eq("sales_status","new").neq("review_status","rejected")
      .order("priority_score",{ascending:false,nullsFirst:false})
      .range(from,to);
  });
  const settled=await Promise.all(pages);
  const rows=[];const errors=[];
  for(const r of settled){if(r.error)errors.push(r.error.message);else rows.push(...(r.data||[]))}
  if(!rows.length&&errors.length)throw new Error(errors.join(" | "));
  return {rows,partialErrors:errors};
}

function permitSummary(r){
  let notes={};
  try{notes=typeof r.permit_notes==="string"?JSON.parse(r.permit_notes):(r.permit_notes||{})}catch{}
  const count=Number(r.permit_history_count??notes.records??notes.total_permits??0)||0;
  const roofCount=Number(notes.roof_permits??notes.recent_roof_permits??0)||0;
  const status=r.permit_evidence_status||"unknown";
  return {status,count,roofCount,checkedAt:r.permit_checked_at||notes.checked_at||null,within10y:r.permit_within_10y??null};
}

export async function GET(req){
  const supabase=supabaseServer();
  if(!supabase)return Response.json({ok:false,error:"Supabase not configured.",leads:[],total:0},{status:500});
  const {searchParams}=new URL(req.url);const requested=searchParams.get("tier");const tier=TIER_CAPS[requested]?requested:"review";const limit=Math.min(Number(searchParams.get("limit"))||TIER_CAPS[tier],TIER_CAPS[tier]);
  let rows=[],partialErrors=[];try{({rows,partialErrors}=await fetchCandidateRows(supabase))}catch(error){return Response.json({ok:false,error:error.message,leads:[],total:0},{status:500})}
  const ranked=rankRows(rows);
  let pool=tier==="contractor"?ranked.filter(r=>r.review_status==="approved"):ranked;
  if(tier==="candidates")pool=pool.slice(0,500);if(tier==="review")pool=pool.slice(0,100);
  const currentYear=new Date().getFullYear();
  const top=pool.slice(0,limit).map((r,i)=>{
    const permit=permitSummary(r);
    const yearBuilt=Number(r.year_built)||null;
    return {
      id:r.id,rank:i+1,address:r.address,city:r.city,county:r.county,lat:r.lat,lon:r.lon,
      propertyClass:r.property_class||null,singleFamilySignal:r.singleFamilySignal||0,
      yearBuilt,propertyAgeYears:yearBuilt?Math.max(0,currentYear-yearBuilt):null,
      assessedValue:r.assessed_value,permit,
      evidenceScore:Number(r.evidenceScore??r.evidence_score??0),confidenceScore:Number(r.confidenceScore??r.confidence_score??0),priorityScore:Number(r.priorityScore??r.priority_score??0),
      humanReview:tier==="review"?true:!!r.humanReview,reviewStatus:r.review_status||"pending",categories:r.categories||[],breakdown:r.breakdown||{},reasons:r.reasons||[],tier:r.tier,
      sourceStatus:r.sourceStatus||{},validationStatus:r.validation_status||"unvalidated",validationScore:r.validation_score??0,validationConfidence:r.validation_confidence??0,lastValidatedAt:r.last_validated_at,scoredAt:r.scored_at,
      imageUrl:null,imageIsFallback:false,
      googleMapsUrl:`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${r.address||""}, ${r.city||""}, MN`)}`,
      streetViewUrl:streetViewUrl(r)
    };
  });
  try{
    const ids=top.map(r=>r.id).filter(Boolean);
    if(ids.length){
      const {data:images}=await supabase.from("property_images").select("property_id,image_url,enhanced_image_url,original_image_url,fetched_at").in("property_id",ids).order("fetched_at",{ascending:false});
      const byId=new Map();
      for(const img of images||[])if(!byId.has(String(img.property_id)))byId.set(String(img.property_id),img.enhanced_image_url||img.image_url||img.original_image_url||null);
      for(const lead of top){const cached=byId.get(String(lead.id));if(cached){lead.imageUrl=cached;lead.imageIsFallback=false;lead.sourceStatus={...lead.sourceStatus,imagery:true}}}
    }
  }catch(e){console.warn(`[top-leads] image lookup failed: ${e.message}`)}
  for(const lead of top)if(!lead.imageUrl&&lead.lat!=null&&lead.lon!=null){lead.imageUrl=freeSatelliteFallback(Number(lead.lat),Number(lead.lon));lead.imageIsFallback=true}
  return Response.json({ok:true,tier,cap:TIER_CAPS[tier],leads:top,total:top.length,scanned:rows.length,entered:ranked.length,top100Count:Math.min(100,ranked.length),top500Count:Math.min(500,ranked.length),liveScored:true,deduped:true,residentialFiltered:true,singleFamilyPrioritized:true,scanPages:MAX_SCAN_PAGES,partialErrors});
}
