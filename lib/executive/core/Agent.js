// Base class every executive agent extends. An agent's whole job is: receive
// business context (from the DataAdapter), reason about its domain, and
// return a structured Recommendation the Boardroom can vote on.
//
// Domain-agnostic by design — ported as-is from the standalone AI Executive
// Engine. Only lib/executive/adapter.js (AeroLeadAI's own DataAdapter) is
// business-specific.

export class Recommendation {
  constructor({
    agent,
    summary,
    action,
    confidence,
    reasoning,
    assumptions = [],
    what_would_change_this = null,
    risk_level = "low",
    financial_impact = null, // { amount_cents, direction: 'gain'|'loss'|'uncertain' }
    legal_risk = null,
    operational_risk = null,
    expected_roi = null,
    rollback_plan = null,
  }) {
    this.agent = agent;
    this.summary = summary;
    this.action = action;
    this.confidence = confidence;
    this.reasoning = reasoning;
    this.assumptions = assumptions;
    this.what_would_change_this = what_would_change_this;
    this.risk_level = risk_level;
    this.financial_impact = financial_impact;
    this.legal_risk = legal_risk;
    this.operational_risk = operational_risk;
    this.expected_roi = expected_roi;
    this.rollback_plan = rollback_plan;
    this.created_at = new Date().toISOString();
  }
}

export class Agent {
  constructor({ name, role, aiClient }) {
    if (!name || !role) throw new Error("Agent requires name and role");
    this.name = name;
    this.role = role;
    this.aiClient = aiClient; // any client exposing .complete({system, messages, temperature, max_tokens})
  }

  async analyze(context, question) {
    throw new Error(`${this.constructor.name} must implement analyze()`);
  }

  async reason({ systemPrompt, userPrompt, temperature = 0 }) {
    const raw = await this.aiClient.complete({
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
      temperature,
      max_tokens: 800,
    });
    return safeParseJSON(raw);
  }
}

export function safeParseJSON(raw) {
  const cleaned = raw.replace(/```json|```/g, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    return { parse_error: true, raw: cleaned.slice(0, 500) };
  }
}
