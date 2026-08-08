import { supabaseServer } from "../../../../lib/supabaseServer";

export async function GET(req){
  const supabase=supabaseServer();
  if(!supabase) return Response.json({ok:false,error:"Supabase not configured."},{status:500});
  const id=new URL(req.url).searchParams.get("id");
  if(!id) return Response.json({ok:false,error:"id required"},{status:400});

  const [{data:property},{data:findings},{data:relationships},{data:snapshots},{data:rechecks}] =
    await Promise.all([
      supabase.from("batch_leads").select("*").eq("id",id).maybeSingle(),
      supabase.from("property_findings").select("*").eq("property_id",id).order("created_at",{ascending:false}),
      supabase.from("property_relationships").select("*").eq("property_id",id).order("created_at",{ascending:false}),
      supabase.from("property_state_snapshots").select("*").eq("property_id",id).order("created_at",{ascending:false}).limit(20),
      supabase.from("evidence_rechecks").select("*").eq("property_id",id).order("priority",{ascending:false})
    ]);

  return Response.json({
    ok:true,
    digitalTwin:property?.digital_twin||{},
    evidenceGraph:property?.evidence_graph||{},
    dataQuality:property?.data_quality_state||"unknown",
    findings:findings||[],
    relationships:relationships||[],
    historicalStates:snapshots||[],
    rechecks:rechecks||[],
    score:{
      priority:property?.priority_score??null,
      hazard:property?.hazard_score??null,
      confidence:property?.evidence_confidence??null,
      completeness:property?.evidence_completeness??null,
      breakdown:property?.evidence_score_breakdown||{}
    }
  });
}
