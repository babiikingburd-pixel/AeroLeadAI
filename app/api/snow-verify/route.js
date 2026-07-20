import { callTextModel, activeProvider } from "../../../lib/aiClient";

export async function POST(req) {
  try {
    const { weatherSummary, structural } = await req.json();

    if (!activeProvider()) {
      return Response.json({ error: "No AI provider configured. Set GROQ_API_KEY (free) or ANTHROPIC_API_KEY." }, { status: 500 });
    }

    const prompt = `You are the Verification Officer for the Snow Load Supervisor.
Weather Analyst summary: "${weatherSummary}"
Structural Analyst estimate: ${JSON.stringify(structural)}
This structural estimate is rule-based, not from real engineering data. Sanity-check whether the
conclusion is reasonable given the weather summary, and always recommend flagging for human review
if the concern score is above 50. Respond ONLY with JSON:
{ "agrees": <true|false>, "flag_for_human": <true|false>, "note": "<one sentence>" }`;

    const { text, provider } = await callTextModel({ prompt });
    const clean = text.replace(/```json|```/g, "").trim();

    try {
      return Response.json({ ...JSON.parse(clean), provider });
    } catch {
      return Response.json({ agrees: true, flag_for_human: (structural?.concern_score || 0) > 50, note: "Could not parse; defaulting to flag if score elevated.", provider });
    }
  } catch (e) {
    return Response.json({ error: e?.message || "Unknown server error" }, { status: 500 });
  }
}
