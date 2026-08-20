import { rankEvidenceTwins } from "../../../../lib/lite/evidenceTwin.mjs";
import { supabaseServer } from "../../../../lib/supabaseServer";

export const dynamic = "force-dynamic";
export const maxDuration = 45;

const MAX_RESULTS = 50;
const MINNESOTA_ZIP = /^(55|56)\d{3}$/;

export async function POST(req) {
  try {
    const body = await req.json();
    const zipCode = String(body.zipCode || "").trim();
    const batchSize = Math.min(Math.max(Number.parseInt(body.batchSize, 10) || 10, 1), MAX_RESULTS);

    if (!MINNESOTA_ZIP.test(zipCode)) {
      return Response.json({ success: false, error: "A valid Minnesota ZIP code is required." }, { status: 400 });
    }

    const supabase = supabaseServer();
    if (!supabase) {
      return Response.json({ success: false, error: "Supabase service role is not configured." }, { status: 500 });
    }

    const { data, error } = await supabase
      .from("batch_leads")
      .select("*")
      .eq("zip", zipCode)
      .order("priority_score", { ascending: false, nullsFirst: false })
      .limit(Math.min(500, batchSize * 10));

    if (error) {
      return Response.json({ success: false, error: `Property-index scan failed: ${error.message}` }, { status: 500 });
    }

    // The old route asked an LLM to invent "realistic" addresses, which can
    // contaminate a lead database. Lite scans only genuine property-index
    // rows and applies the same Minnesota/residential Evidence Twin gate as
    // the daily Top-500 refresh.
    const ranked = rankEvidenceTwins(data || []).slice(0, batchSize);
    const leads = ranked.map((row) => ({
      ...row,
      priority_score: row.evidenceTwin.rankScore,
      opportunity_score: row.evidenceTwin.opportunityScore,
      evidence_confidence: row.evidenceTwin.evidenceConfidence,
      contractor_value_score: row.evidenceTwin.contractorValueScore,
      score_status: row.evidenceTwin.scoreStatus,
      classification: row.evidenceTwin.classification,
    }));

    return Response.json({
      success: true,
      synthetic: false,
      source: "secure_minnesota_property_index",
      zipCode,
      scanned: data?.length || 0,
      leads,
      scannedAt: new Date().toISOString(),
      note: leads.length
        ? "Real indexed properties ranked with the Lite Evidence Twin."
        : "No eligible indexed properties are loaded for this ZIP yet; no synthetic leads were created.",
    });
  } catch (error) {
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
}
