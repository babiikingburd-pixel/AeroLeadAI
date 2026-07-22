import { callVisionModel, activeProvider } from "../../../lib/aiClient";
import { isValidImagePayload } from "../../../lib/validate";

// AI-estimated roof measurements from overhead imagery. This is a rough
// order-of-magnitude estimate for the inspection report, not a substitute
// for a measured takeoff (Eagleview/measured drone survey) — labeled as such
// everywhere it's displayed.
export async function POST(req) {
  try {
    const { base64Image, mediaType, address, buildingAge } = await req.json();
    if (!isValidImagePayload(base64Image, mediaType)) {
      return Response.json({ error: "Valid overhead image required." }, { status: 400 });
    }
    if (!activeProvider()) {
      return Response.json({ error: "No AI provider configured. Set GROQ_API_KEY (free) or ANTHROPIC_API_KEY." }, { status: 500 });
    }

    const prompt = `You are estimating rough roof measurements from a satellite/overhead image of
"${address || "a property"}"${buildingAge ? ` (building age ~${buildingAge} years)` : ""}.
This is a ROUGH VISUAL ESTIMATE for a sales inspection report, not a measured takeoff.
Respond ONLY with JSON, no preamble:
{
  "estimated_area_sqft": <integer, rough order of magnitude>,
  "roof_shape": "<gable|hip|flat|gambrel|mixed|unknown>",
  "estimated_facets": <integer>,
  "estimated_pitch": "<low|moderate|steep|unknown>",
  "confidence": "<low|medium|high>",
  "caveat": "<one sentence reminding this is a rough visual estimate>"
}`;
    const { text, provider } = await callVisionModel({ base64Image, mediaType, prompt });
    const clean = text.replace(/```json|```/g, "").trim();
    let parsed;
    try { parsed = JSON.parse(clean); }
    catch { parsed = { estimated_area_sqft: null, roof_shape: "unknown", estimated_facets: null, estimated_pitch: "unknown", confidence: "low", caveat: "Could not parse measurement response." }; }
    return Response.json({ ...parsed, provider });
  } catch (e) {
    return Response.json({ error: e?.message || "Unknown server error" }, { status: 500 });
  }
}
