import { callVisionModel, activeProvider } from "../../../lib/aiClient";
import { isValidImagePayload } from "../../../lib/validate";

// Annotated damage detection: same vision pipeline as /api/damage-agent,
// but asks for normalized bounding boxes per damage finding instead of a
// single concern score, so the UI can draw overlays on the actual image
// (components/RoofAnnotationViewer.jsx) instead of just reporting a number.
// Conservative by design — the prompt explicitly forbids inventing findings
// it can't see, and reports its own confidence rather than a fixed value.
const SYSTEM_PROMPT = `You are a roof damage assessment AI. You analyze satellite/aerial imagery of
residential roofs and identify visible damage. You are conservative and evidence-based: only report
damage you can actually see in the image, and reflect real uncertainty in your confidence scores.
Respond with ONLY valid JSON, no markdown fences, no preamble, matching this schema:
{
  "damage": [
    {
      "type": "missing_shingles" | "granule_loss" | "hail_impact" | "flashing_damage" | "ponding_water" | "structural_sag" | "moss_algae",
      "severity": "minor" | "moderate" | "severe",
      "confidence": number (0-1),
      "bounding_box": { "x": number, "y": number, "width": number, "height": number },
      "description": string
    }
  ],
  "overall_confidence": number (0-1),
  "notes": string
}
bounding_box coordinates are normalized 0-1 fractions of image width/height (x,y = top-left corner).
If you see no damage, return an empty damage array — do not invent findings.`;

export async function POST(req) {
  try {
    const { base64Image, mediaType, address } = await req.json();
    if (!isValidImagePayload(base64Image, mediaType)) {
      return Response.json({ error: "Valid image required." }, { status: 400 });
    }
    if (!activeProvider()) {
      return Response.json({ error: "No AI provider configured. Set GROQ_API_KEY (free) or ANTHROPIC_API_KEY." }, { status: 500 });
    }

    const prompt = `${SYSTEM_PROMPT}\n\nAnalyze the roof at ${address || "an unspecified property"}. Respond with JSON only.`;
    const { text, provider } = await callVisionModel({ base64Image, mediaType, prompt });
    const clean = text.replace(/```json|```/g, "").trim();

    let parsed;
    try { parsed = JSON.parse(clean); }
    catch { return Response.json({ error: "Could not parse annotation response.", raw: clean.slice(0, 200) }, { status: 200 }); }

    return Response.json({ damage: parsed.damage || [], overall_confidence: parsed.overall_confidence ?? 0, notes: parsed.notes || "", provider });
  } catch (e) {
    return Response.json({ error: e?.message || "Unknown server error" }, { status: 500 });
  }
}
