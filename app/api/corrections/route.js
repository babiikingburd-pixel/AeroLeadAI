// Real corrections come from a person: "the AI said 82, the actual roof
// condition/inspection/permit said 91." This endpoint records that, and
// links it to the original prediction so the heartbeat's resolvePredictions
// loop can compute a real error_magnitude next cycle.
//
// This is intentionally simple — a human (contractor, Lucky, anyone using
// the app) posts a corrected score for an address+domain. No auto-detection
// of ground truth is invented here; that would be fabricating data.

import { supabasePost, supabaseGet, normalizeAddress } from "../../../lib/supabaseRest";
export const dynamic = "force-dynamic";

export async function POST(req) {
  const { address, domain, correctedScore, reason, correctedBy } = await req.json();
  if (!address || !domain || correctedScore === undefined) {
    return Response.json({ ok: false, error: "address, domain, and correctedScore required" }, { status: 400 });
  }

  const addressNorm = normalizeAddress(address);

  // Find the most recent unresolved prediction for this address+domain to link against
  const predRes = await supabaseGet(
    `predictions?address_normalized=eq.${addressNorm}&domain=eq.${domain}&order=predicted_at.desc&limit=1`
  );
  const prediction = predRes.ok && predRes.data?.[0];

  const insertRes = await supabasePost("corrections", [{
    prediction_id: prediction?.prediction_id || null,
    address_normalized: addressNorm, domain,
    original_score: prediction?.predicted_score ?? null,
    corrected_score: correctedScore,
    reason: reason || null,
    corrected_by: correctedBy || "user",
  }]);

  if (!insertRes.ok) {
    return Response.json({ ok: false, error: insertRes.error, notConfigured: insertRes.notConfigured });
  }

  return Response.json({
    ok: true,
    linkedToPrediction: !!prediction,
    notes: prediction
      ? `Linked to prediction from ${prediction.predicted_at} (was ${prediction.predicted_score}). Will resolve on next heartbeat cycle.`
      : "No matching prediction found for this address/domain — correction saved standalone.",
  });
}

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const address = searchParams.get("address");
  if (!address) return Response.json({ ok: false, error: "address required" }, { status: 400 });

  const res = await supabaseGet(`corrections?address_normalized=eq.${normalizeAddress(address)}&select=*&order=created_at.desc`);
  return Response.json({ ok: res.ok, corrections: res.data, error: res.error });
}
