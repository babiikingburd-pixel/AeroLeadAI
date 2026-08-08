import { supabaseServer } from "../../../../lib/supabaseServer";

export const maxDuration = 60;

export async function POST(req) {
  const supabase = supabaseServer();
  if (!supabase) return Response.json({ok:false,error:"Supabase not configured."},{status:500});
  const body = await req.json().catch(()=>({}));
  const limit = Math.min(Number(body.limit)||10,25);

  const {data: leads,error} = await supabase.from("batch_leads")
    .select("id,address,city,county,lat,lon,priority_score,confidence_score,evidence_completeness,evidence_confidence")
    .eq("sales_status","new")
    .neq("review_status","rejected")
    .order("priority_score",{ascending:false})
    .order("evidence_completeness",{ascending:false})
    .limit(500);

  if(error) return Response.json({ok:false,error:error.message},{status:500});

  const now=new Date().toISOString();
  const rows=(leads||[]).map((x,i)=>({
    id:x.id,
    top500_rank:i+1,
    top500_rank_checked_at:now,
    evidence_pipeline_status:x.evidence_completeness>=90 ? "complete" : "needs_evidence"
  }));
  for(let i=0;i<rows.length;i+=50){
    await Promise.all(rows.slice(i,i+50).map(r=>
      supabase.from("batch_leads").update({
        top500_rank:r.top500_rank,
        top500_rank_checked_at:r.top500_rank_checked_at,
        evidence_pipeline_status:r.evidence_pipeline_status
      }).eq("id",r.id)
    ));
  }

  const weak=(leads||[]).filter(x=>(Number(x.evidence_completeness)||0)<90).slice(0,limit);
  for(const x of weak){
    await supabase.from("evidence_queue").upsert({
      property_id:x.id,
      job_type:"complete_evidence",
      priority:501-(x.top500_rank||500),
      status:"queued",
      pipeline_version:"APEX11.0"
    },{onConflict:"property_id,job_type"});
  }

  return Response.json({
    ok:true,
    ranked:rows.length,
    queuedForEnrichment:weak.length,
    rule:"Top 500 is dynamically re-ranked from persisted evidence; incomplete candidates are queued for enrichment."
  });
}
