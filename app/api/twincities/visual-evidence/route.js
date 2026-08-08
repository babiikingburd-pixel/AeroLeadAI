import { supabaseServer } from "../../../../lib/supabaseServer";

export const maxDuration = 30;

const TARGETS = [
  "property_overview",
  "roof_detail",
  "driveway_detail",
  "exterior_detail",
  "grounds_detail"
];

export async function POST(req) {
  const supabase = supabaseServer();
  if (!supabase) return Response.json({ok:false,error:"Supabase not configured."},{status:500});
  const body = await req.json().catch(()=>({}));
  const propertyId = body.propertyId;
  if (!propertyId) return Response.json({ok:false,error:"propertyId required"},{status:400});

  const {data: images} = await supabase.from("property_images")
    .select("*").eq("property_id", propertyId).order("fetched_at",{ascending:false});

  const base = (images || []).find(x => x.image_kind === "property_overview") || images?.[0];
  if (!base) return Response.json({ok:false,error:"No source imagery available yet."},{status:404});

  // Queue crop/enhancement jobs as durable records. An external worker can consume
  // these rows without forcing the web request to hold an image-processing job open.
  const jobs = [];
  for (const target of TARGETS) {
    const {data, error} = await supabase.from("image_evidence_jobs").upsert({
      property_id: propertyId,
      source_image_id: base.id,
      target_kind: target,
      status: "queued",
      requested_at: new Date().toISOString(),
      pipeline_version: "APEX10.3"
    }, {onConflict:"property_id,target_kind"}).select().single();
    if (!error && data) jobs.push(data);
  }

  return Response.json({
    ok:true,
    propertyId,
    sourceImageId: base.id,
    queued: jobs.length,
    targets: TARGETS
  });
}
