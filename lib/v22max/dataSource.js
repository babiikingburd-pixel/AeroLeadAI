import {supabase,supabaseAdmin,isSupabaseConfigured} from "../supabase.js";

const DEMO=[
  {id:"demo-1",address:"1420 Maple Ridge Dr",city:"Minneapolis",county:"hennepin",state:"MN",zip:"55403",property_class:"single family",year_built:1998,priority_score:88,evidence_score:74,confidence_score:81,validation_score:66,roof_visual_score:79,assessed_value:412000,permit_evidence_status:"none_found",permit_within_10y:false,value_evidence_status:"verified",image_evidence_status:"fetched",storm_evidence_status:"verified",created_at:"2026-06-20T00:00:00Z",updated_at:"2026-07-28T00:00:00Z"}
];

const blocked=/apartment|multifamily|multi-family|commercial|industrial|office|retail|hotel|school|church|condo building|duplex|triplex|fourplex|townhome complex/i;
const unit=/\b(apt|apartment|unit|suite|ste|#)\s*[a-z0-9-]+\b/i;
export function residentialEnough(r={}){const text=`${r.property_class||""} ${r.address||""}`;return !!r.address&&!blocked.test(text)&&!unit.test(String(r.address||""));}

const text=v=>String(v??"").trim().toLowerCase();
const zipOf=r=>String(r.zip||r.zip_code||r.postal_code||r.postcode||"").trim();
export function territoryMatch(r={},filters={}){
  if(filters.city&&text(r.city)!==text(filters.city))return false;
  if(filters.county&&!text(r.county).includes(text(filters.county)))return false;
  if(filters.state&&text(r.state||r.state_code||"MN")!==text(filters.state))return false;
  if(filters.zip&&zipOf(r)!==String(filters.zip).trim())return false;
  return true;
}

export async function getLeads(limit=500,filters={}){
  const wanted=Math.min(Math.max(Number(limit)||500,1),1000);
  const c=supabaseAdmin||supabase;
  if(isSupabaseConfigured&&c){
    for(const table of ["batch_leads","leads"]){
      const {data,error}=await c.from(table).select("*").order("priority_score",{ascending:false,nullsFirst:false}).limit(Math.min(Math.max(wanted*3,750),1500));
      if(!error&&data?.length){
        const rows=data.filter(r=>String(r.review_status||"").toLowerCase()!=="rejected").filter(residentialEnough).filter(r=>territoryMatch(r,filters)).slice(0,wanted);
        return {rows,dataMode:"live",table,error:null,filters};
      }
    }
    return {rows:[],dataMode:"live",table:null,error:"No readable lead table or query timed out",filters};
  }
  return {rows:DEMO.filter(r=>territoryMatch(r,filters)).slice(0,wanted),dataMode:"demo",filters};
}

export function demoLeads(limit=200){return DEMO.slice(0,limit);}

export async function getLeadById(id){
  const c=supabaseAdmin||supabase;
  if(isSupabaseConfigured&&c){
    for(const table of ["batch_leads","leads"]){
      const {data,error}=await c.from(table).select("*").eq("id",id).limit(1);
      if(!error&&data?.length)return{row:data[0],dataMode:"live",table};
    }
    return{row:null,dataMode:"live",table:null};
  }
  return{row:DEMO.find(x=>x.id===id)||null,dataMode:"demo"};
}

export async function getLeadImages(ids=[]){
  const c=supabaseAdmin||supabase;
  if(!c||!ids.length)return{};
  try{
    const {data,error}=await c.from("property_images").select("*").in("property_id",ids.slice(0,500)).limit(2000);
    if(error||!data)return{};
    return data.reduce((acc,img)=>{const id=String(img.property_id||"");if(!id)return acc;(acc[id]||(acc[id]=[])).push(img);return acc;},{});
  }catch{return{};}
}

export function supabaseStatus(){return{configured:Boolean(isSupabaseConfigured),adminClient:Boolean(supabaseAdmin),browserClient:Boolean(supabase)}}
