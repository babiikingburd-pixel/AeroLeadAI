import { supabaseServer } from "../../../../lib/supabaseServer";
export const dynamic="force-dynamic";
export const maxDuration=30;

const checks=["permit","storm","imagery","assessor"];
function priority(row,rank){const base=Number(row.priority_score||row.evidence_fusion_score||row.opportunity_score||0);const conf=Number(row.evidence_confidence||row.confidence_score||0);return Math.min(1000,900-rank+(base*2)+Math.max(0,70-conf));}
function unique(rows){const seen=new Set();return rows.filter(r=>{const k=String(r.parcel_id||r.property_id||r.address_normalized||r.address||r.id);if(!k||seen.has(k))return false;seen.add(k);return !r.excluded&&r.review_status!=="rejected";});}

export async function POST(req){
 const supabase=supabaseServer();if(!supabase)return Response.json({ok:false,error:"Supabase not configured."},{status:500});
 const {businessName}=await req.json().catch(()=>({}));if(!businessName)return Response.json({ok:false,error:"businessName required"},{status:400});
 const {data:contractor,error:ce}=await supabase.from("contractor_candidates").select("*").eq("business_name",businessName).maybeSingle();if(ce||!contractor)return Response.json({ok:false,error:ce?.message||"Contractor not found"},{status:404});
 const cities=(contractor.service_area_cities||[]).filter(Boolean);let q=supabase.from("batch_leads").select("id,address,city,state,zip,parcel_id,property_id,address_normalized,priority_score,evidence_fusion_score,opportunity_score,evidence_confidence,confidence_score,review_status,excluded,enrichment_status").eq("sales_status","new").neq("review_status","rejected").limit(600);if(cities.length)q=q.in("city",cities);
 let {data:rows,error}=await q;if(error)return Response.json({ok:false,error:error.message},{status:500});let leads=unique(rows||[]);
 if(!leads.length){const fb=await supabase.from("batch_leads").select("id,address,city,state,zip,parcel_id,property_id,address_normalized,priority_score,evidence_fusion_score,opportunity_score,evidence_confidence,confidence_score,review_status,excluded,enrichment_status").eq("sales_status","new").neq("review_status","rejected").not("lat","is",null).order("priority_score",{ascending:false}).limit(300);if(fb.error)return Response.json({ok:false,error:fb.error.message},{status:500});leads=unique(fb.data||[]);}
 leads=leads.sort((a,b)=>Number(b.priority_score||b.evidence_fusion_score||0)-Number(a.priority_score||a.evidence_fusion_score||0)).slice(0,100);
 const now=new Date().toISOString();const jobs=leads.slice(0,50).map((l,i)=>({property_id:l.id,priority:priority(l,i),reason:`contractor_supercharge:${businessName}`,requested_checks:checks,status:"queued",next_attempt_at:now}));
 let queued=0;if(jobs.length){const ins=await supabase.from("twincities_validation_jobs").insert(jobs).select("id");if(!ins.error)queued=ins.data?.length||jobs.length;}
 await supabase.from("contractor_candidates").update({pitch_status:"prioritized",pitch_last_generated_at:now}).eq("id",contractor.id);
 return Response.json({ok:true,contractor,serviceArea:cities,matched:leads.length,queued,mode:cities.length?"SERVICE_AREA_SUPERCHARGE":"TWIN_CITIES_FALLBACK",message:`${businessName} supercharged: ${queued} high-priority evidence jobs queued.`});
}
