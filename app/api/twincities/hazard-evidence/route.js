import { supabaseServer } from "../../../../lib/supabaseServer";

const TARGETS = [
  ["tree_detail","TREES"],
  ["utility_detail","POWER_LINES"],
  ["tree_utility_relationship","TREE_UTILITY"],
  ["historical_2y","HISTORICAL"],
  ["historical_4y","HISTORICAL"],
];

export async function POST(req){
  const supabase=supabaseServer();
  if(!supabase) return Response.json({ok:false,error:"Supabase not configured."},{status:500});
  const body=await req.json().catch(()=>({}));
  const propertyId=body.propertyId;
  if(!propertyId) return Response.json({ok:false,error:"propertyId required"},{status:400});

  const rows=TARGETS.map(([target_category,target_kind])=>({
    property_id:propertyId,
    target_kind,
    target_category,
    status:"queued",
    requested_at:new Date().toISOString(),
    pipeline_version:"APEX11.2-12.0"
  }));

  const {data,error}=await supabase.from("image_evidence_jobs")
    .upsert(rows,{onConflict:"property_id,target_kind"})
    .select();

  if(error) return Response.json({ok:false,error:error.message},{status:500});
  return Response.json({
    ok:true,
    propertyId,
    queued:data?.length||0,
    policy:"Current + ~2y + ~4y by default; ten-year deep dive is available for expanded review."
  });
}
