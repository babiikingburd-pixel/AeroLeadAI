import { supabaseServer } from "../../../../lib/supabaseServer";
export const dynamic = "force-dynamic";

export async function POST(req) {
  const supabase = supabaseServer();
  if (!supabase) return Response.json({ok:false,error:"Supabase not configured."},{status:500});

  const {data: jobs, error} = await supabase.from("image_evidence_jobs")
    .select("*, property_images(*)")
    .eq("status","queued")
    .order("requested_at",{ascending:true})
    .limit(10);
  if (error) return Response.json({ok:false,error:error.message},{status:500});

  // This worker deliberately does not claim that a crop was generated unless
  // an actual image-processing backend is configured. It claims jobs so a real
  // processor can consume them safely and persist outputs.
  return Response.json({
    ok:true,
    claimed:0,
    availableJobs:jobs?.length||0,
    message:"Jobs are queued durably. Connect the image-processing worker to generate verified crops/enhancements; no synthetic damage imagery is created."
  });
}
