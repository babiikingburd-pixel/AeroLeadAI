// Governance core — multi-round voting among agents, mandatory human
// escalation if consensus isn't reached by round 3, a global kill switch,
// and dry-run mode so nothing executes against a real business until it's
// trusted. Domain-agnostic, ported as-is from the standalone engine.

export const MAX_VOTING_ROUNDS = 3;

export class GovernanceError extends Error {
  constructor(message, { requiresHuman = false } = {}) {
    super(message);
    this.requiresHuman = requiresHuman;
  }
}

export class Governance {
  constructor({ killSwitchOn = false, dryRun = true } = {}) {
    this.killSwitchOn = killSwitchOn;
    this.dryRun = dryRun;
    this.log = [];
  }

  engage() {
    this.killSwitchOn = false;
  }

  kill(reason) {
    this.killSwitchOn = true;
    this._record({ event: "kill_switch_engaged", reason });
  }

  setDryRun(on) {
    this.dryRun = on;
    this._record({ event: "dry_run_toggled", on });
  }

  _record(entry) {
    this.log.push({ ...entry, at: new Date().toISOString() });
  }

  async voteOnAction({ proposedAction, recommendations, reconsiderFn }) {
    if (this.killSwitchOn) {
      throw new GovernanceError("Kill switch is engaged — no actions can be voted on or executed.", { requiresHuman: true });
    }

    const highRisk = recommendations.some((r) => r.risk_level === "high");
    if (highRisk) {
      this._record({ event: "escalated", reason: "high risk recommendation present", proposedAction });
      return { approved: false, requiresHuman: true, reason: "One or more agents flagged this as high risk." };
    }

    let current = recommendations;
    for (let round = 1; round <= MAX_VOTING_ROUNDS; round++) {
      const supportFraction = current.filter((r) => r.action && r.confidence >= 0.6).length / current.length;
      this._record({ event: "vote_round", round, supportFraction, proposedAction });

      if (supportFraction >= 0.66) {
        return { approved: true, round, requiresHuman: false, executed: !this.dryRun };
      }

      if (round < MAX_VOTING_ROUNDS && reconsiderFn) {
        current = await reconsiderFn(current, round);
      }
    }

    this._record({ event: "escalated", reason: "no consensus after max rounds", proposedAction });
    return { approved: false, requiresHuman: true, reason: `No consensus reached after ${MAX_VOTING_ROUNDS} rounds — needs a human decision.` };
  }

  checkUnanimous(recommendations) {
    const highRisk = recommendations.some((r) => r.risk_level === "high");
    if (highRisk) {
      this._record({ event: "escalated", reason: "high risk recommendation present during negotiation" });
      return { unanimous: false, requiresHuman: true, reason: "One or more agents flagged this as high risk." };
    }

    const dissenters = recommendations.filter((r) => !r.action || r.confidence < 0.6);
    const unanimous = dissenters.length === 0;

    this._record({
      event: "negotiation_round",
      unanimous,
      dissenters: dissenters.map((d) => ({ agent: d.agent, objection: d.objection || d.reasoning })),
    });

    return {
      unanimous,
      requiresHuman: false,
      dissenters: dissenters.map((d) => ({ agent: d.agent, objection: d.objection || d.reasoning })),
    };
  }

  recordEscalation(reason) {
    this._record({ event: "escalated", reason });
  }

  getAuditLog() {
    return this.log;
  }
}
