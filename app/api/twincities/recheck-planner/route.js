import { supabaseServer } from "../../../../lib/supabaseServer";

export async function POST(req){
  const supabase=supabaseServer();
  if(!supabase) return Response.json({ok:false,error:"Supabase not configured."},{status:500});
  const body=await req.json().catch(()=>({}));
  const limit=Math.min(Number(body.limit)||500,500);

  const {data:rows,error}=await supabase.from("batch_leads")
    .select("id,priority_score,evidence_completeness,evidence_confidence,score_volatility,evidence_age_days")
    .order("priority_score",{ascending:false})
    .limit(limit);

  if(error) return Response.json({ok:false,error:error.message},{status:500});

  const now=Date.now();
  const jobs=[];
  for(const r of rows||[]){
    const completeness=Number(r.evidence_completeness)||0;
    const confidence=Number(r.evidence_confidence)||0;
    const volatility=Number(r.score_volatility)||0;
    const age=Number(r.evidence_age_days)||9999;
    const urgency=(100-completeness)+(100-confidence)+volatility+Math.min(age,365)/7;
    if(urgency>80){
      jobs.push({
        property_id:r.id,
        reason:"evidence_weak_or_stale",
        priority:urgency,
        due_at:new Date(now+Math.min(30,Math.max(1,Math.round(urgency/10)))*86400000).toISOString(),
        status:"queued"
      });
    }
  }

  for(let i=0;i<jobs.length;i+=100){
    await Promise.all(jobs.slice(i,i+100).map(j=>
      supabase.from("evidence_rechecks").insert(j)
    ));
  }

  return Response.json({ok:true,scanned:rows?.length||0,scheduled:jobs.length});
}
