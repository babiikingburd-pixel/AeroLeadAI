import { CEOAgent } from "../../../../lib/executive/agents/CEOAgent";
import { AeroLeadAIAdapter } from "../../../../lib/executive/adapter";
import { createExecutiveAIClient, activeProvider } from "../../../../lib/executive/aiClient";

// Quick advisory mode — CEOAgent.runSession(question) with no proposedAction,
// so no vote, no Fifth Business, no persisted decision. For "what's the
// state of the business" questions, not formal decisions that need a
// negotiation trail and human sign-off (use /api/executive/decisions for those).
export const maxDuration = 45;

export async function POST(req) {
  if (!activeProvider()) {
    return Response.json({ ok: false, error: "No AI provider configured. Set GROQ_API_KEY (free) or ANTHROPIC_API_KEY." }, { status: 400 });
  }
  try {
    const { question } = await req.json();
    if (!question) return Response.json({ ok: false, error: "question is required." }, { status: 400 });

    const ceo = new CEOAgent({ aiClient: createExecutiveAIClient(), dataAdapter: new AeroLeadAIAdapter() });
    const result = await ceo.runSession(question);
    return Response.json({ ok: true, result });
  } catch (e) {
    return Response.json({ ok: false, error: e.message }, { status: 500 });
  }
}
