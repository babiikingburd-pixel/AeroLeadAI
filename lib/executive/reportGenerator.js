import { supabaseServer } from "../supabaseServer";

// Turns a decision record (negotiation rounds, objections, second opinion)
// into a plain-English markdown report — the thing a human actually reads to
// understand WHY something is stuck, not a JSON blob. `renderDecisionReport`
// is ported verbatim (pure function) from the standalone engine.
export function renderDecisionReport(decision) {
  const lines = [];
  lines.push(`# Decision Report: ${decision.id}`);
  lines.push("");
  lines.push(`**Question:** ${decision.question}`);
  lines.push(`**Proposed action:** ${decision.proposedAction}`);
  lines.push(`**Status:** ${decision.status}`);
  lines.push(`**Created:** ${decision.created_at}`);
  if (decision.dependsOn) lines.push(`**Depends on:** ${decision.dependsOn}`);
  lines.push("");

  lines.push("## Executive Team Positions");
  const recs = decision.result?.agent_recommendations || [];
  if (recs.length === 0) {
    lines.push("_No agent recommendations recorded._");
  } else {
    recs.forEach((r) => {
      lines.push(`### ${r.agent}`);
      lines.push(`- **Position:** ${r.action || "withholding agreement"} (confidence ${Math.round((r.confidence || 0) * 100)}%, risk: ${r.risk_level})`);
      lines.push(`- **Reasoning:** ${r.reasoning}`);
      lines.push("");
    });
  }

  if (decision.result?.synthesis) {
    lines.push("## CEO Synthesis");
    lines.push(decision.result.synthesis.executive_summary || "_No synthesis available._");
    lines.push("");
  }

  const negotiation = decision.result?.negotiation;
  if (negotiation) {
    lines.push("## Negotiation Trail (Fifth Business objections)");
    if (negotiation.objection_history?.length) {
      negotiation.objection_history.forEach((o) => lines.push(`- ${o}`));
    } else {
      lines.push("_No objections recorded — reached agreement without contention._");
    }
    lines.push("");
    lines.push(`**Outcome:** ${negotiation.unanimous ? "Unanimous agreement reached" : "Escalated — no unanimous agreement reached"}`);
    if (negotiation.reason) lines.push(`**Reason:** ${negotiation.reason}`);
    lines.push("");
  }

  if (decision.second_opinion) {
    lines.push("## Second Opinion (fresh council, informational only — not auto-applied)");
    lines.push(decision.second_opinion.summary);
    lines.push("");
    const so = decision.second_opinion.details;
    if (so?.objection_history?.length) {
      lines.push("**Fresh council's own objection trail:**");
      so.objection_history.forEach((o) => lines.push(`- ${o}`));
      lines.push("");
    }
    lines.push(`**Fresh council outcome:** ${decision.second_opinion.unanimous ? "Reached unanimous agreement" : "Also got stuck"}`);
    lines.push("");
  }

  if (decision.human_resolution) {
    lines.push("## Human Resolution");
    lines.push(`**Decision:** ${decision.human_resolution.approved ? "Approved" : "Rejected"}`);
    lines.push(`**Rationale:** ${decision.human_resolution.rationale}`);
    lines.push(`**Resolved at:** ${decision.human_resolution.resolved_at}`);
  }

  return lines.join("\n");
}

// Replaces the original fs.writeFileSync + chmodSync(0o444) "read-only file"
// approach — not viable on Vercel's ephemeral filesystem. The Supabase
// equivalent is the decision_reports table's RLS policy, which only grants
// select + insert (see supabase_phase2_schema.sql) — no update/delete, so a
// written report is just as tamper-evident as a chmod 0444 file.
export async function writeDecisionReport(decision) {
  const supabase = supabaseServer();
  const content = renderDecisionReport(decision);
  if (!supabase) return { ok: false, reason: "Supabase not configured — report was not persisted.", content };
  const { data, error } = await supabase.from("decision_reports").insert({ decision_id: decision.id, content }).select().single();
  if (error) return { ok: false, reason: error.message, content };
  return { ok: true, id: data.id, content };
}
