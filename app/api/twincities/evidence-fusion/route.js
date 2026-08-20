import { supabaseServer } from "../../../../lib/supabaseServer";
import { fuseEvidence, recordFusion } from "../../../../lib/twincities/evidenceFusion";
export const dynamic = "force-dynamic";

export const maxDuration = 60;
function authorized(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  return req.headers.get("authorization") === `Bearer ${secret}` ||
    new URL(req.url).searchParams.get("secret") === secret;
}

export async function POST(req) {
  if (!authorized(req)) return Response.json({ ok:false, error:"Unauthorized" }, {status:401});
  const supabase = supabaseServer();
  if (!supabase) return Response.json({ok:false,error:"Supabase not configured"}, {status:500});
  let body={}; try { body=await req.json(); } catch {}
  const limit=Math.min(Math.max(Number(body.limit)||50,1),250);
  const county=body.county || "Hennepin";
  const { data: rows, error } = await supabase.from("batch_leads")
    .select("*").eq("county",county)
    .order("priority_score",{ascending:false,nullsFirst:false}).limit(limit);
  if(error) return Response.json({ok:false,error:error.message},{status:500});

  const out=[];
  for(const row of rows||[]) {
    const result=fuseEvidence(row);
    const {error: upErr}=await supabase.from("batch_leads").update({
      evidence_quality_score:result.evidenceQuality,
      evidence_fusion_score:result.evidenceFusionScore,
      evidence_fusion_confidence:result.evidenceFusionConfidence,
      challenger_score:result.challengerScore,
      last_fused_at:new Date().toISOString(),
      evidence_fusion_version:"APEX9.9"
    }).eq("id",row.id);
    if(upErr) continue;
    await recordFusion(supabase,row,result);
    out.push({id:row.id,...result});
  }
  return Response.json({ok:true,version:"APEX9.9",processed:out.length,results:out});
}
