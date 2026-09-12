import { callVisionModel, activeProvider } from "../../../lib/aiClient";
import { isValidImagePayload } from "../../../lib/validate";
export const dynamic = "force-dynamic";

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

const clamp = (value, min = 0, max = 100) => Math.max(min, Math.min(max, Number(value) || 0));
function normalizeFindings(findings) {
  if (!Array.isArray(findings)) return [];
  return findings.slice(0, 8).map((finding, index) => {
    const box = finding?.box || {};
    const x = clamp(box.x), y = clamp(box.y), w = clamp(box.w), h = clamp(box.h);
    const hasBox = w > 0 && h > 0;
    return {
      id: String(finding?.id || `concern-${index + 1}`),
      label: String(finding?.label || "Possible visual concern").slice(0, 100),
      severity: ["low", "medium", "high"].includes(String(finding?.severity).toLowerCase()) ? String(finding.severity).toLowerCase() : "medium",
      confidence: ["low", "medium", "high"].includes(String(finding?.confidence).toLowerCase()) ? String(finding.confidence).toLowerCase() : "low",
      rationale: String(finding?.rationale || "Visual pattern warrants contractor inspection.").slice(0, 240),
      box: hasBox ? { x, y, w: Math.min(w, 100 - x), h: Math.min(h, 100 - y) } : null,
    };
  });
}

export async function POST(req) {
  try {
    const { domain, base64Image, mediaType, images, address } = await req.json();
    const cfg = DOMAIN_PROMPTS[domain];
    if (!cfg) return Response.json({ error: "Unknown domain: " + domain }, { status: 400 });

    if (!activeProvider()) {
      return Response.json({ error: "No AI provider configured. Set GROQ_API_KEY (free) or ANTHROPIC_API_KEY in Vercel/​.env.local." }, { status: 500 });
    }

    const imgList = images && images.length ? images : (base64Image ? [{ base64Image, mediaType }] : []);
    if (imgList.length === 0) return Response.json({ error: "No image(s) provided." }, { status: 400 });
    if (imgList.length > 12) return Response.json({ error: "Too many images (max 12)." }, { status: 400 });
    for (const im of imgList) {
      if (!isValidImagePayload(im.base64Image, im.mediaType)) {
        return Response.json({ error: "Invalid or oversized image payload (max 8MB, image/* only)." }, { status: 400 });
      }
    }

    const multiAngleNote = imgList.length > 1
      ? `You are looking at ${imgList.length} different images of the SAME property from different angles/vantage points. Cross-reference across all images before scoring. Bounding boxes must refer to the FIRST image only; findings visible only in later images should use box:null.`
      : "Bounding boxes refer to this image.";

    const prompt = `You are the ${cfg.label} Analyst inside AeroLeadAI Property Intelligence, examining "${address || "an unspecified property"}".
${multiAngleNote}
Look for: ${cfg.look}.
This is remote visual triage, NOT a physical inspection. Never claim damage is confirmed. Describe visible patterns as possible concerns/opportunities that should be inspected by a qualified contractor.

For each useful visible concern, provide an approximate bounding box in percentage coordinates relative to the FIRST image: x and y are the upper-left corner, w and h are width and height, each from 0 to 100. If you cannot localize a concern reliably, use null for box. Do not invent a box.

Respond ONLY with JSON, no preamble, no markdown fences:
{
  "concern_score": <0-100 integer, higher = stronger inspection opportunity>,
  "indicators": ["<short visible pattern>", ...],
  "findings": [
    {
      "id": "concern-1",
      "label": "<short possible concern>",
      "severity": "<low|medium|high>",
      "confidence": "<low|medium|high>",
      "rationale": "<why this area deserves inspection>",
      "box": {"x": <0-100>, "y": <0-100>, "w": <0-100>, "h": <0-100>} | null
    }
  ],
  "confidence": "<low|medium|high>",
  "notes": "<one sentence>"
}`;

    const { text, provider } = await callVisionModel({ images: imgList, prompt });
    const clean = text.replace(/```json|```/g, "").trim();

    let parsed;
    try {
      parsed = JSON.parse(clean);
    } catch {
      parsed = { concern_score: 0, indicators: [], findings: [], confidence: "low", notes: "Could not parse analyst response.", parse_error: true };
    }
    const concernScore = clamp(parsed.concern_score);
    const findings = normalizeFindings(parsed.findings);
    const level = concernScore >= 75 ? "severe" : concernScore >= 50 ? "high" : concernScore >= 25 ? "moderate" : "low";
    return Response.json({
      ...parsed,
      concern_score: concernScore,
      findings,
      level,
      provider,
      finding_policy: "possible_visual_concerns_not_confirmed_damage",
    });
  } catch (e) {
    return Response.json({ error: e?.message || "Unknown server error" }, { status: 500 });
  }
}
