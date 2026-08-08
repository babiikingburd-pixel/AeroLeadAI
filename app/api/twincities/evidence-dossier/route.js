import { supabaseServer } from "../../../../lib/supabaseServer";

export async function GET(req){
  const supabase=supabaseServer();
  if(!supabase) return Response.json({ok:false,error:"Supabase not configured."},{status:500});
  const id=new URL(req.url).searchParams.get("id");
  if(!id) return Response.json({ok:false,error:"id required"},{status:400});

  const [{data:lead},{data:images},{data:jobs},{data:snapshots}] = await Promise.all([
    supabase.from("batch_leads").select("*").eq("id",id).maybeSingle(),
    supabase.from("property_images").select("*").eq("property_id",id).order("fetched_at",{ascending:false}),
    supabase.from("image_evidence_jobs").select("*").eq("property_id",id).order("requested_at",{ascending:false}),
    supabase.from("evidence_snapshots").select("*").eq("property_id",id).order("created_at",{ascending:false}).limit(20)
  ]);

  return Response.json({
    ok:true,
    dossier:{
      property:lead,
      images:images||[],
      visualJobs:jobs||[],
      scoreBreakdown:lead?.evidence_score_breakdown||{},
      snapshot:lead?.evidence_snapshot||{},
      snapshots:snapshots||[]
    }
  });
}
