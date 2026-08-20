import { supabaseServer } from "../../../../lib/supabaseServer";
import { signImageRows } from "../../../../lib/imagery/privateStorage.mjs";
import { evaluateLead } from "../../../../lib/gatekeeper16";

export const dynamic="force-dynamic";
export const revalidate=0;

export async function GET(req){
  try{
    const id=new URL(req.url).searchParams.get("id");
    if(!id) return Response.json({success:false,error:"id required"},{status:400});
    const c=supabaseServer();
    if(!c) return Response.json({success:false,error:"Supabase service role is not configured."},{status:500});
    const {data:lead,error}=await c.from("batch_leads").select("*").eq("id",id).maybeSingle();
    if(error) throw error;
    if(!lead) return Response.json({success:false,error:"property not found"},{status:404});
    const [{data:images},{data:findings},{data:events},{data:leaderboard}] = await Promise.all([
      c.from("property_images").select("*").eq("property_id",id).order("fetched_at",{ascending:false}).limit(20),
      c.from("top500_crawler_findings").select("*").eq("property_id",id).order("created_at",{ascending:false}).limit(25),
      c.from("apex_evidence_events").select("*").eq("lead_id",id).order("created_at",{ascending:false}).limit(25),
      c.from("territory_leaderboard_current").select("*").eq("lead_id",id).order("created_at",{ascending:false}).limit(5)
    ]);
    const imageRows=await signImageRows(c,images||[],900);
    return Response.json({success:true,system:"V23 GateKeeper Clean Audit",property:lead,gatekeeper:evaluateLead(lead,imageRows),images:imageRows,findings:findings||[],evidenceEvents:events||[],leaderboard:leaderboard||[],unknowns:{permit:lead.permit_evidence_status||"unknown",image:lead.image_evidence_status||"unknown",weather:lead.weather_evidence_status||lead.storm_evidence_status||"unknown",value:lead.value_evidence_status||"unknown",validation:lead.validation_status||"unknown"}});
  }catch(e){return Response.json({success:false,error:e?.message||String(e)},{status:500});}
}
