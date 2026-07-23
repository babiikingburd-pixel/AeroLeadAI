import { Agent, Recommendation } from "../core/Agent";

// The Fifth Business — named for the role in drama that's neither hero nor
// villain but is essential to how the story resolves. Here: the agent whose
// entire job is to NOT agree by default. When CFO, COO, CMO, CLO, and CSO
// all say yes, this agent's starting position is no — forcing the team to
// actually negotiate and defend the decision instead of rubber-stamping a
// quick majority. It must give a real, specific objection every round; if it
// runs out of real objections, it says so and switches to yes.
const SYSTEM_PROMPT = `You are the Fifth Business agent of an AI executive team — the built-in
dissenter. Your default position on any proposed action is NO. Your job is to find the
strongest real objection: a risk the other agents are underweighting, an assumption nobody
checked, a downside that only shows up later. You are not being difficult for its own sake —
if you genuinely cannot find a real objection after seeing the other agents' reasoning, say so
plainly and change your vote to yes. Never invent a fake objection just to stay contrarian.
Respond with ONLY JSON:
{
  "summary": string,
  "action": string or null (null means you are withholding agreement — action stays null until you're genuinely convinced),
  "confidence": number (0-1),
  "reasoning": string,
  "objection": string or null (your specific, concrete objection this round — null only if you've run out of real objections and are switching to yes),
  "risk_level": "low" | "medium" | "high",
  "financial_impact": { "amount_cents": number, "direction": "gain" | "loss" | "uncertain" } or null,
  "legal_risk": "low" | "medium" | "high" or null,
  "operational_risk": "low" | "medium" | "high" or null,
  "expected_roi": number or null,
  "rollback_plan": string or null
}`;

export class FifthBusinessAgent extends Agent {
  constructor({ aiClient }) {
    super({ name: "FifthBusiness", role: "Mandatory dissent and negotiation", aiClient });
  }

  async analyze({ proposedAction, otherRecommendations = [], priorObjections = [] }, question) {
    const result = await this.reason({
      systemPrompt: SYSTEM_PROMPT,
      userPrompt: [
        `Proposed action: ${proposedAction}`,
        `Founder's question: ${question || "n/a"}`,
        `Other agents' recommendations this round:\n${JSON.stringify(otherRecommendations, null, 2)}`,
        priorObjections.length ? `Your own objections from earlier rounds (do not just repeat these — either sharpen them or move past them):\n${priorObjections.join("\n")}` : "This is round 1 — you have not objected yet.",
      ].join("\n\n"),
    });

    if (result.parse_error) {
      return new Recommendation({ agent: this.name, summary: "Analysis failed — model did not return valid JSON.", action: null, confidence: 0, reasoning: result.raw, risk_level: "high" });
    }
    const rec = new Recommendation({ agent: this.name, ...result });
    rec.objection = result.objection || null;
    return rec;
  }
}
