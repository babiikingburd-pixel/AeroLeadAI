import { supabaseServer } from "../../../../lib/supabaseServer";

export async function GET(req) {
  const supabase = supabaseServer();
  if (!supabase) return Response.json({ ok:false, error:"Supabase not configured." }, {status:500});
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return Response.json({ok:false,error:"id required"}, {status:400});

  const [{data: lead}, {data: images}, {data: permits}] = await Promise.all([
    supabase.from("batch_leads").select("*").eq("id", id).maybeSingle(),
    supabase.from("property_images").select("*").eq("property_id", id).order("fetched_at",{ascending:false}),
    supabase.from("permits").select("*").eq("property_id", id).order("permit_date",{ascending:false})
  ]);

  const byKind = {};
  for (const image of images || []) {
    byKind[image.image_kind || image.crop_kind || "property_overview"] ||= image;
  }

  return Response.json({
    ok:true,
    property: lead || null,
    images: byKind,
    imageCount: (images || []).length,
    permits: permits || [],
    completeness: lead?.evidence_completeness ?? 0,
    confidence: lead?.evidence_confidence ?? 0,
  });
}
