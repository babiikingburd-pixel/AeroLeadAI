import { supabaseServer } from "../../../../../lib/supabaseServer";
import { signImageRows } from "../../../../../lib/imagery/privateStorage.mjs";
import { scoreEvidenceTwin } from "../../../../../lib/lite/evidenceTwin.mjs";

export const dynamic = "force-dynamic";

export async function GET(_request, { params }) {
  const propertyId = String(params?.id || "").trim();
  if (!propertyId) return Response.json({ ok: false, error: "Property id is required." }, { status: 400 });

  const supabase = supabaseServer();
  if (!supabase) return Response.json({ ok: false, error: "Supabase service role is not configured." }, { status: 500 });

  const [propertyResult, imageResult, findingResult, storedScoreResult] = await Promise.all([
    supabase.from("batch_leads").select("*").eq("id", propertyId).maybeSingle(),
    supabase.from("property_images").select("*").eq("property_id", propertyId).order("fetched_at", { ascending: false }).limit(20),
    supabase.from("top500_crawler_findings").select("*").eq("property_id", propertyId).order("created_at", { ascending: false }).limit(100),
    supabase.from("aerolead_property_scores").select("*").eq("property_id", propertyId).maybeSingle(),
  ]);

  if (propertyResult.error) return Response.json({ ok: false, error: propertyResult.error.message }, { status: 500 });
  if (!propertyResult.data) return Response.json({ ok: false, error: "Property not found." }, { status: 404 });

  let images = imageResult.data || [];
  try {
    images = await signImageRows(supabase, images, 900);
  } catch (error) {
    console.warn("[lite-evidence-twin] image signing failed", error.message);
  }

  const twin = scoreEvidenceTwin(propertyResult.data, {
    images,
    findings: findingResult.data || [],
    globalRank: storedScoreResult.data?.lite_rank || null,
  });

  return Response.json({
    ok: true,
    property: propertyResult.data,
    images,
    storedScore: storedScoreResult.data || null,
    twin,
    sourceErrors: [imageResult.error?.message, findingResult.error?.message, storedScoreResult.error?.message].filter(Boolean),
  });
}
