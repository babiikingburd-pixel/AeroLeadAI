import { callVisionModel, activeProvider } from "../../../lib/aiClient";

const DOMAIN_PROMPTS = {
  roof: {
    label: "Roof",
    look: "shingle granule loss, missing/lifted shingles, patching, moss or staining, hail bruising, wind damage signatures, sagging, worn ridge lines, roof age indicators",
  },
  tree: {
    label: "Tree",
    look: "dead or dying limbs, disease signs (fungus, discoloration, cankers), lean angle relative to structures, root heaving, storm damage, canopy thinning, proximity risk to the building or driveway",
  },
  driveway: {
    label: "Driveway",
    look: "cracking patterns, heaving or settling, spalling, drainage pooling, edge crumbling, tree-root intrusion",
  },
};

export async function POST(req) {
  try {
    const { domain, base64Image, mediaType, images, address } = await req.json();
    const cfg = DOMAIN_PROMPTS[domain];
    if (!cfg) return Response.json({ error: "Unknown domain: " + domain }, { status: 400 });

    if (!activeProvider()) {
      return Response.json({ error: "No AI provider configured. Set GROQ_API_KEY (free) or ANTHROPIC_API_KEY in Vercel/​.env.local." }, { status: 500 });
    }

    // Accepts either a single image (base64Image/mediaType, backward compat)
    // or the full multi-angle sweep (images: [{base64Image, mediaType, label}]).
    // When multiple images are sent, the model is told explicitly that it's
    // looking at several angles of the SAME property so it can cross-reference
    // instead of scoring each shot in isolation.
    const imgList = images && images.length ? images : (base64Image ? [{ base64Image, mediaType }] : []);
    if (imgList.length === 0) return Response.json({ error: "No image(s) provided." }, { status: 400 });

    const multiAngleNote = imgList.length > 1
      ? `You are looking at ${imgList.length} different images of the SAME property from different angles/vantage points (satellite overview, street-level views, possibly a roofline-pitched shot). Cross-reference across all images before scoring — damage visible from one angle but not another is still real damage; note which angle(s) show which findings.`
      : "";

    const prompt = `You are the ${cfg.label} Analyst inside AeroLeadAI Property Intelligence, examining "${address || "an unspecified property"}".
${multiAngleNote}
Look for: ${cfg.look}.
Respond ONLY with JSON, no preamble, no markdown fences:
{
  "concern_score": <0-100 integer, higher = more concern/risk>,
  "indicators": ["<short phrase>", ...],
  "confidence": "<low|medium|high>",
  "notes": "<one sentence>"
}`;

    const { text, provider } = await callVisionModel({ images: imgList, prompt });
    const clean = text.replace(/```json|```/g, "").trim();

    let parsed;
    try {
      parsed = JSON.parse(clean);
    } catch {
      parsed = { concern_score: 0, indicators: [], confidence: "low", notes: "Could not parse analyst response." };
    }
    const level = parsed.concern_score >= 75 ? "severe" : parsed.concern_score >= 50 ? "high" : parsed.concern_score >= 25 ? "moderate" : "low";
    return Response.json({ ...parsed, level, provider });
  } catch (e) {
    return Response.json({ error: e?.message || "Unknown server error" }, { status: 500 });
  }
}
