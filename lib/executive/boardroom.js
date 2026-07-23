import { CEOAgent } from "./agents/CEOAgent";
import { Governance } from "./core/Governance";
import { DecisionRegistry } from "./decisionRegistry";
import { writeDecisionReport } from "./reportGenerator";

// Boardroom — the layer above a single CEOAgent session. Ported from the
// standalone engine with two changes: the DecisionRegistry is now
// Supabase-backed (survives across serverless invocations) so every method
// that touched it synchronously is now async/awaited, and report writing
// goes to the decision_reports table instead of the filesystem.
//
// - Independent decisions run concurrently. A stuck pricing decision does not
//   block a hiring decision unless you explicitly say one depends on it.
// - Dependent decisions (dependsOn: <id>) are blocked, not silently run, if
//   the decision they depend on is currently stuck.
// - A stuck decision can get a SECOND OPINION: a fresh council re-runs it
//   from a clean slate. That result is INFORMATION, never an automatic
//   override — the human still makes the final call.
export class Boardroom {
  constructor({ dataAdapter, aiClient, dryRun = true, registry }) {
    this.dataAdapter = dataAdapter;
    this.aiClient = aiClient;
    this.dryRun = dryRun;
    this.registry = registry || new DecisionRegistry();
  }

  async proposeDecision({ id, question, proposedAction, dependsOn = null }) {
    if (dependsOn && (await this.registry.isStuck(dependsOn))) {
      await this.registry.create({ id, question, proposedAction, dependsOn });
      return this.registry.update(id, { status: "blocked_by_dependency" });
    }

    await this.registry.create({ id, question, proposedAction, dependsOn });
    await this.registry.update(id, { status: "negotiating" });

    const governance = new Governance({ dryRun: this.dryRun });
    const ceo = new CEOAgent({ aiClient: this.aiClient, dataAdapter: this.dataAdapter, governance });
    const result = await ceo.runSession(question, { proposedAction });

    const status = result.negotiation?.unanimous ? "approved" : result.negotiation?.requiresHuman ? "escalated" : "negotiating";
    const updated = await this.registry.update(id, { status, result });

    if (status === "escalated") {
      await writeDecisionReport(updated);
    }

    return updated;
  }

  // Runs a brand new council (fresh Fifth Business, no memory of the
  // original deadlock) from scratch. Returns BOTH the original stuck result
  // and the second opinion side by side — never overwrites or auto-resolves
  // the decision. Call resolveByHuman() yourself once you've looked at both.
  async requestSecondOpinion(decisionId) {
    const decision = await this.registry.get(decisionId);
    if (!decision) throw new Error(`Decision ${decisionId} not found`);
    if (decision.status !== "escalated") {
      throw new Error(`Decision ${decisionId} is not currently stuck (status: ${decision.status}) — no second opinion needed.`);
    }

    const freshGovernance = new Governance({ dryRun: this.dryRun });
    const freshCeo = new CEOAgent({ aiClient: this.aiClient, dataAdapter: this.dataAdapter, governance: freshGovernance });
    const secondResult = await freshCeo.runSession(decision.question, { proposedAction: decision.proposedAction });

    const secondOpinion = {
      unanimous: !!secondResult.negotiation?.unanimous,
      summary: secondResult.negotiation?.unanimous
        ? "The fresh council reached unanimous agreement — this is new evidence, not a decision. Review it against the original objection below before deciding."
        : "The fresh council also got stuck — this reinforces that the original objection is likely a real, substantive issue rather than argument fatigue.",
      details: secondResult.negotiation,
    };

    const updated = await this.registry.update(decisionId, { second_opinion: secondOpinion });
    const report = await writeDecisionReport(updated);

    return {
      decision_id: decisionId,
      original_stuck_result: decision.result?.negotiation,
      second_opinion: secondOpinion,
      report,
      note: 'This decision is still status "escalated" — nothing was auto-applied. Call resolveByHuman() to close it out.',
    };
  }

  // The human's final word — the only thing that actually closes a stuck decision.
  async resolveByHuman(decisionId, { approved, rationale }) {
    const updated = await this.registry.update(decisionId, {
      status: "resolved_by_human",
      human_resolution: { approved, rationale, resolved_at: new Date().toISOString() },
    });
    await writeDecisionReport(updated);
    return updated;
  }

  async getDecision(id) {
    return this.registry.get(id);
  }

  async listDecisions(filter) {
    return this.registry.list(filter);
  }
}
