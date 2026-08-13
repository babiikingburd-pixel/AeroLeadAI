import { supabaseServer } from "../../../../lib/supabaseServer";
export const dynamic = "force-dynamic";

export async function POST(){
  const supabase=supabaseServer();
  if(!supabase) return Response.json({ok:false,error:"Supabase not configured."},{status:500});

  const {data:leads,error}=await supabase.from("batch_leads")
    .select("id,priority_score,evidence_completeness,evidence_confidence")
    .eq("sales_status","new")
    .neq("review_status","rejected")
    .order("priority_score",{ascending:false})
    .limit(500);
  if(error) return Response.json({ok:false,error:error.message},{status:500});

  const queue=[];
  for(const x of leads||[]){
    const completeness=Number(x.evidence_completeness)||0;
    const confidence=Number(x.evidence_confidence)||0;
    if(completeness<95 || confidence<90){
      queue.push({
        property_id:x.id,
        job_type:"evidence_recheck",
        priority:(Number(x.priority_score)||0)+(100-completeness)+(100-confidence),
        status:"queued",
        pipeline_version:"APEX11.0"
      });
    }
  }
  for(let i=0;i<queue.length;i+=100){
    await Promise.all(queue.slice(i,i+100).map(x=>
      supabase.from("evidence_queue").upsert(x,{onConflict:"property_id,job_type"})
    ));
  }
  return Response.json({ok:true,queued:queue.length,scanned:(leads||[]).length});
}
