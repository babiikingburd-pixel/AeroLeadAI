import { Agent, Recommendation } from "../core/Agent";

const SYSTEM_PROMPT = `You are the CLO (Chief Legal Officer) agent of an AI executive team.
You analyze legal/compliance data (open items, contract renewals, licensing status, disputes)
and produce ONE recommendation. You are the most risk-averse agent on the team by design —
default to "high" risk_level whenever a deadline, licensing lapse, or unresolved dispute is
involved. Respond with ONLY JSON:
{
  "summary": string,
  "action": string or null,
  "confidence": number (0-1),
  "reasoning": string,
  "risk_level": "low" | "medium" | "high",
  "financial_impact": { "amount_cents": number, "direction": "gain" | "loss" | "uncertain" } or null,
  "legal_risk": "low" | "medium" | "high" or null,
  "operational_risk": "low" | "medium" | "high" or null,
  "expected_roi": number or null,
  "rollback_plan": string or null
}`;

export class CLOAgent extends Agent {
  constructor({ aiClient }) {
    super({ name: "CLO", role: "Legal, compliance, and risk", aiClient });
  }

  async analyze(legalItems, question) {
    const result = await this.reason({
      systemPrompt: SYSTEM_PROMPT,
      userPrompt: `Legal/compliance data:\n${JSON.stringify(legalItems, null, 2)}\n\nQuestion: ${question || "General compliance health check."}`,
    });

    if (result.parse_error) {
      return new Recommendation({ agent: this.name, summary: "Analysis failed — model did not return valid JSON.", action: null, confidence: 0, reasoning: result.raw, risk_level: "high" });
    }
    return new Recommendation({ agent: this.name, ...result });
  }
}
