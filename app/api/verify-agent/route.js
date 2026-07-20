import { callVisionModel, activeProvider } from "../../../lib/aiClient";

const DOMAIN_LABELS = { roof: "Roof", tree: "Tree", driveway: "Driveway" };

export async function POST(req) {
  try {
    const { domain, base64Image, mediaType, finding } = await req.json();
    const label = DOMAIN_LABELS[domain] || domain;

    if (!activeProvider()) {
      return Response.json({ error: "No AI provider configured. Set GROQ_API_KEY (free) or ANTHROPIC_API_KEY." }, { status: 500 });
    }

    const prompt = `You are the Verification Officer for the ${label} Supervisor. An analyst produced this finding
on the attached image: ${JSON.stringify(finding)}.
Independently re-examine the image. Respond ONLY with JSON, no preamble:
{
  "agrees": <true|false>,
  "adjusted_score": <0-100 integer, your independent estimate>,
  "confidence": "<low|medium|high>",
  "flag_for_human": <true|false, true if evidence is ambiguous or stakes are high>,
  "note": "<one sentence>"
}`;

    const { text, provider } = await callVisionModel({ base64Image, mediaType, prompt });
    const clean = text.replace(/```json|```/g, "").trim();

    try {
      return Response.json({ ...JSON.parse(clean), provider });
    } catch {
      return Response.json({ agrees: true, adjusted_score: finding?.concern_score, confidence: "low", flag_for_human: true, note: "Could not parse verification response.", provider });
    }
  } catch (e) {
    return Response.json({ error: e?.message || "Unknown server error" }, { status: 500 });
  }
}
