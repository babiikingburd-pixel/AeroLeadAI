import { supabaseServer } from "../../../../../../lib/supabaseServer";
export const dynamic = "force-dynamic";

function dbStatus(v="New") {
  return ({New:"new",Contacted:"contacted",Quoted:"estimate_scheduled",Won:"won",Lost:"lost"})[v] || "new";
}
export async function PATCH(req,{params}) {
  const supabase=supabaseServer();
  if(!supabase) return Response.json({ok:false,error:"Supabase not configured"},{status:503});
  const body=await req.json().catch(()=>({}));
  const update={sales_status:dbStatus(body.status)};
  if(typeof body.notes==="string") update.notes=body.notes.slice(0,5000);
  const {data,error}=await supabase.from("batch_leads").update(update).eq("id",params.id).select("id,sales_status,notes").maybeSingle();
  if(error) return Response.json({ok:false,error:error.message},{status:500});
  if(!data) return Response.json({ok:false,error:"Lead not found"},{status:404});
  return Response.json({ok:true,lead:data});
}
