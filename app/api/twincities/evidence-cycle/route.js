import { supabaseServer } from "../../../../lib/supabaseServer";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_LIMIT = 6;
const DEFAULT_LIMIT = 4;
const TOP_POOL = 600;
const BAND_PLAN = [
  { start: 1, end: 25, slots: 2 },
  { start: 26, end: 100, slots: 1 },
  { start: 101, end: 500, slots: 1 },
  { start: 501, end: 600, slots: 1 },
];

function auth(req){
  const secret=process.env.CRON_SECRET, origin=req.headers.get("origin")||"", host=req.headers.get("host")||"";
  if(host&&origin&&origin.includes(host)) return true;
  if(!secret) return true;
  return req.headers.get("authorization")===`Bearer ${secret}`||new URL(req.url).searchParams.get("secret")===secret;
}
async function fetchJson(url,options={},timeout=9000){
  try{const res=await fetch(url,{...options,signal:AbortSignal.timeout(timeout)});const data=await res.json().catch(()=>({}));return{ok:res.ok,status:res.status,data};}
  catch(e){return{ok:false,status:0,data:{error:e.message}};}
}
function lastTouched(r){return Math.max(0,...[r.evidence_cycle_at,r.top500_last_investigated_at,r.weather_checked_at,r.permit_checked_at,r.image_fetched_at].map(v=>v?Date.parse(v):0).filter(Number.isFinite));}
function selectSwarm(rows,limit){
  const ranked=rows.map((r,i)=>({...r,__rank:i+1,__lastTouched:lastTouched(r)})),picked=[],used=new Set();
  const add=r=>{if(r&&picked.length<limit&&!used.has(String(r.id))){used.add(String(r.id));picked.push(r)}};
  if(ranked[0]&&Number(ranked[0].confidence_score||0)<85)add(ranked[0]);
  for(const band of BAND_PLAN){let slots=Math.min(band.slots,limit-picked.length);for(const r of ranked.filter(x=>x.__rank>=band.start&&x.__rank<=band.end&&!used.has(String(x.id))).sort((a,b)=>a.__lastTouched-b.__lastTouched||a.__rank-b.__rank)){if(slots--<=0||picked.length>=limit)break;add(r)}}
  for(const r of ranked.filter(x=>!used.has(String(x.id))).sort((a,b)=>a.__lastTouched-b.__lastTouched||a.__rank-b.__rank))add(r);
  return picked.slice(0,limit);
}

async function processRow(row,origin,supabase){
  const address=`${row.address}, ${row.city||""}, MN`,started=new Date().toISOString();
  const [permit,weather,imagery]=await Promise.all([
    fetchJson(`${origin}/api/permit-lookup?address=${encodeURIComponent(address)}`,{},7000),
    fetchJson(`${origin}/api/weather-agent`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({lat:row.lat,lon:row.lon,address})},7000),
    fetchJson(`${origin}/api/imagery-agent`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({lat:row.lat,lon:row.lon,address:row.address,leadId:row.id,lite:true,force:false})},9000),
  ]);
  const records=Array.isArray(permit.data?.records)?permit.data.records:[];
  const roofPermits=records.filter(p=>p.roof_related===true||/roof|shingle|reroof|re-roof|roofing/i.test(`${p.permit_type||""} ${p.description||""}`));
  const patch={
    permit_evidence_status:permit.ok?(records.length?"verified":"none_found"):(row.permit_evidence_status||"unknown"),
    permit_checked_at:permit.ok?started:(row.permit_checked_at||null),
    permit_notes:JSON.stringify({checked_at:started,total_permits:records.length,roof_permits:roofPermits.length,swarm_rank:row.__rank}),
    permit_history_count:records.length,permit_history:records,
    image_evidence_status:imagery.ok?"fetched":(row.image_evidence_status||"unknown"),
    image_fetched_at:imagery.ok?started:(row.image_fetched_at||null),
    weather_evidence_status:weather.ok?"verified":(row.weather_evidence_status||"unknown"),
    storm_evidence_status:weather.ok?"verified":(row.storm_evidence_status||"unknown"),
    weather_checked_at:weather.ok?started:(row.weather_checked_at||null),storm_checked_at:weather.ok?started:(row.storm_checked_at||null),
    weather_evidence:weather.ok?weather.data:(row.weather_evidence||null),evidence_cycle_at:started,evidence_cycle_version:"AERO15-RESPONSIVE-SWARM",
    top500_last_investigated_at:row.__rank<=500?started:(row.top500_last_investigated_at||null),
  };
  if(weather.ok){patch.freeze_thaw_signal=!!weather.data?.freezeThawSignal;patch.current_snow_signal=Number(weather.data?.snowPeriods||0)>0;patch.weather_summary=weather.data?.summary||null;}
  const {error}=await supabase.from("batch_leads").update(patch).eq("id",row.id);
  if(error)return{id:row.id,rank:row.__rank,address:row.address,persisted:false,error:error.message};
  return{id:row.id,rank:row.__rank,address:row.address,persisted:true,confidenceBefore:row.confidence_score,permitsFound:records.length,roofPermits:roofPermits.length,weatherChecked:weather.ok,imageryFetched:imagery.ok};
}

export async function POST(req){
  if(!auth(req))return Response.json({ok:false,error:"Unauthorized"},{status:401});
  const supabase=supabaseServer();if(!supabase)return Response.json({ok:false,error:"Supabase not configured."},{status:500});
  let body={};try{body=await req.json()}catch{}
  const limit=Math.min(Math.max(1,Number(body.limit)||DEFAULT_LIMIT),MAX_LIMIT),origin=new URL(req.url).origin;
  const {data:ranked,error}=await supabase.from("batch_leads").select("*").eq("sales_status","new").neq("review_status","rejected").gt("priority_score",0).not("lat","is",null).not("lon","is",null).order("priority_score",{ascending:false}).order("confidence_score",{ascending:false,nullsFirst:false}).limit(TOP_POOL);
  if(error)return Response.json({ok:false,error:error.message},{status:500});
  if(!ranked?.length)return Response.json({ok:true,processed:0,persisted:0,note:"No scored candidates remain."});
  const rows=selectSwarm(ranked,limit);
  const results=await Promise.all(rows.map(r=>processRow(r,origin,supabase)));
  const persisted=results.filter(r=>r.persisted).length;
  // Keep the button responsive: persist evidence first, then let the existing validation queue rescore asynchronously on its next cycle.
  return Response.json({ok:true,version:"AERO15-RESPONSIVE-SWARM",processed:results.length,persisted,poolSize:ranked.length,results,note:"Evidence persisted without blocking the UI on sequential rescoring."});
}
