import { supabaseServer } from "../../../lib/supabaseServer";
import { calculatePriority } from "../../../lib/twincities/priorityEngine";
import { requestPropertyData, findRequestId, getPropertyResult, extractPropertyImages } from "../../../lib/eagleview";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const FALLBACK_PROSPECTS=[
{business_name:"APEX Exteriors LLC",prospect_score:96,service_area_cities:["Apple Valley","Eagan","Burnsville","Lakeville","Rosemount"]},
{business_name:"Incline Exteriors",prospect_score:92,service_area_cities:["Excelsior","Deephaven","Minnetonka","Chanhassen","Chaska","Edina","Eden Prairie","Wayzata"]},
{business_name:"Grussing Roofing & Exteriors",prospect_score:91,service_area_cities:["Eden Prairie","Edina","St Louis Park","Chaska","Chanhassen","Maple Grove","Bloomington"]},
{business_name:"Storm ReNu",prospect_score:90,service_area_cities:["Bloomington","Richfield","Edina","Eagan","Burnsville"]},
{business_name:"Keyprime Roofing and Remodeling",prospect_score:89,service_area_cities:["Golden Valley","Robbinsdale","St Louis Park","Plymouth","Maple Grove","Minneapolis"]}
];
const EV_PRODUCTS=["property_data_id_003","property_data_id_004","property_data_id_008","property_data_id_009"];
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

function scoreRow(row){
  const result=calculatePriority({county:row.county,yearBuilt:row.year_built,permit_within_10y:row.permit_within_10y,
    permitChecked:["verified","none_found"].includes(row.permit_evidence_status)||!!row.permit_checked_at||!!row.permit_notes,
    stormChecked:row.weather_evidence_status==="verified"||row.storm_evidence_status==="verified"||!!row.weather_checked_at||!!row.storm_checked_at||!!row.storm_date,
    assessorChecked:Number(row.assessed_value||0)>0,
    imageryChecked:["verified","fetched","ready","reviewed"].includes(String(row.image_evidence_status||"").toLowerCase())||!!row.image_fetched_at,
    hailInches:row.hail_inches,windMph:row.wind_mph,assessedValue:row.assessed_value,reviewStatus:row.review_status,roofEstimateUsd:row.replacement_cost??null,
    heavySnowRegion:row.damage_notes?.heavySnowRegion===true,heavyRainRegion:row.damage_notes?.heavyRainRegion===true,
    treeOverhang:row.damage_notes?.treeOverhang===true||(row.tree_score??0)>=50,largeOverhang:row.damage_notes?.largeOverhang===true||(row.tree_score??0)>=80,
    drivewayCrackRisk:(row.driveway_score??0)>=50,gutterIndicator:row.damage_notes?.gutterIndicator===true});
  return {...row,_score:result.priorityScore,evidenceScore:result.evidenceScore,confidenceScore:result.confidenceScore,entered:result.entered};
}
function normalizedAddress(row){return String(row.address||row.property_address||"").toLowerCase().replace(/\b(apt|apartment|unit|suite|ste|#)\s*[a-z0-9-]+\b/g,"").replace(/[^a-z0-9]/g,"").trim()}
function propertyKey(row){return String(row.parcel_id||row.pid||row.property_id||row.apn||normalizedAddress(row)||`${row.lat||""},${row.lon||""}`)}
function isLikelySingleFamily(row){const type=String(row.property_type||row.building_type||row.land_use||row.use_code||row.occupancy||row.property_class||"").toLowerCase(),addr=String(row.address||row.property_address||"").toLowerCase();if(/(apartment|multi[- ]?family|multifamily|condo|condominium|townhome|townhouse|commercial|retail|office|industrial|mixed use|assisted living|senior living|hotel|motel)/.test(type))return false;if(/\b(apt|apartment|unit|suite|ste)\b|#\s*[a-z0-9-]+/.test(addr))return false;return Number(row.units||row.unit_count||row.dwelling_units||1)<=1}
function dedupeResidential(rows){const seen=new Set(),out=[];for(const row of rows){if(!isLikelySingleFamily(row))continue;const key=propertyKey(row);if(!key||seen.has(key))continue;seen.add(key);out.push(row)}return out}
function contractorCities(selected){return /\bapex\b/i.test(selected?.business_name||"")?["Apple Valley","Eagan","Burnsville","Lakeville","Rosemount"]:(selected?.service_area_cities||[])}
async function waitForEagleView(requestId,maxWaitMs=9000){const started=Date.now();while(Date.now()-started<maxWaitMs){const result=await getPropertyResult(requestId);const status=String(result?.data?.request?.status||result?.data?.status||"").toLowerCase();if(result?.status===200&&status!=="in progress"&&status!=="processing")return result.data;await sleep(800)}return null}
async function enrichImagery(lead){try{const address=[lead.address||lead.property_address,lead.city,lead.state||"MN",lead.zip].filter(Boolean).join(", ");if(!address&&!(lead.lat&&lead.lon))return {...lead,images:[],image_status:"UNAVAILABLE"};const submitted=await requestPropertyData({address,lat:lead.lat,lon:lead.lon,productIds:EV_PRODUCTS});const requestId=findRequestId(submitted);if(!requestId)return {...lead,images:[],image_status:"SUBMITTED"};const data=await waitForEagleView(requestId);const images=extractPropertyImages(data).map(img=>({...img,proxyUrl:`/api/eagleview?imageToken=${encodeURIComponent(img.token)}`}));return {...lead,images,image_status:images.length?"READY":"SEARCHING",eagleview_request_id:requestId}}catch(e){return {...lead,images:[],image_status:"SEARCHING",image_error:e?.message||"EagleView imagery unavailable"}}}
async function enrichTopLeads(leads){const out=new Array(leads.length);let cursor=0;async function worker(){while(cursor<leads.length){const i=cursor++;out[i]=await enrichImagery(leads[i])}}await Promise.all([worker(),worker(),worker()]);return out}

export async function GET(request){
  const {searchParams}=new URL(request.url),name=searchParams.get("name"),supabase=supabaseServer();
  if(!supabase){const selected=name?FALLBACK_PROSPECTS.find(p=>p.business_name===name):null;return Response.json({ok:true,prospects:FALLBACK_PROSPECTS,contractor:selected||null,leads:[],note:"Supabase not configured."})}
  try{
    let q=supabase.from("contractor_candidates").select("*").eq("prospect",true).order("prospect_score",{ascending:false});if(name)q=q.eq("business_name",name);
    const {data:prospects,error}=await q;if(error)throw error;const list=prospects||[];if(name&&!list.length)return Response.json({ok:false,error:"Contractor prospect not found."},{status:404});
    const selected=name?list[0]:null;let leads=[],territoryFallback=false,requestedCities=[];
    if(selected){
      requestedCities=contractorCities(selected);
      let leadQuery=supabase.from("batch_leads").select("*").eq("sales_status","new").neq("review_status","rejected").limit(1500);if(requestedCities.length)leadQuery=leadQuery.in("city",requestedCities);
      let {data,error:leadError}=await leadQuery;if(leadError)throw leadError;
      let ranked=dedupeResidential((data||[]).map(scoreRow).filter(r=>r.entered&&r._score>0).sort((a,b)=>b._score-a._score));
      if(ranked.length===0){
        territoryFallback=true;
        const fallbackQuery=await supabase.from("batch_leads").select("*").eq("sales_status","new").neq("review_status","rejected").not("lat","is",null).not("lon","is",null).order("priority_score",{ascending:false}).limit(800);
        if(fallbackQuery.error)throw fallbackQuery.error;
        ranked=dedupeResidential((fallbackQuery.data||[]).map(scoreRow).filter(r=>r.entered&&r._score>0).sort((a,b)=>b._score-a._score));
      }
      const isApex=/\bapex\b/i.test(selected.business_name||""),visible=ranked.slice(0,isApex?50:10),eagerCount=Math.min(visible.length,isApex?9:visible.length);
      const eager=await enrichTopLeads(visible.slice(0,eagerCount));
      leads=[...eager,...visible.slice(eagerCount).map(lead=>({...lead,images:[],image_status:"QUEUED"}))];
    }
    return Response.json({ok:true,prospects:list.length?list:FALLBACK_PROSPECTS,contractor:selected,leads,imagery_mode:selected?"EAGER_EAGLEVIEW":"IDLE",territoryFallback,requestedCities});
  }catch(e){const selected=name?FALLBACK_PROSPECTS.find(p=>p.business_name===name):null;if(name&&!selected)return Response.json({ok:false,error:e.message},{status:500});return Response.json({ok:true,prospects:FALLBACK_PROSPECTS,contractor:selected||null,leads:[],note:`Database/provider error: ${e.message}`})}
}
