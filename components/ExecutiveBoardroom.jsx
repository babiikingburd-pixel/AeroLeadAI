"use client";
import { useEffect, useState } from "react";

const SLATE = "#0d1420", PANEL = "#131c2b", PANEL2 = "#0f1725", LINE = "#22304a", TEXT = "#dfe6ee", MUTE = "#77839a";
const AMBER = "#f5b942", BLUE = "#4fa3e3", GREEN = "#4fc98e", RED = "#ef5a6f";

const STATUS_COLOR = {
  pending: MUTE, negotiating: BLUE, approved: GREEN, escalated: RED,
  blocked_by_dependency: AMBER, resolved_by_human: TEXT,
};

function slugify(s) {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 60) || `decision-${Date.now()}`;
}

// AI Executive Engine — a boardroom of CFO/COO/CMO/CLO/CSO agents plus a
// mandatory-dissent "Fifth Business" agent. Two modes: a quick ADVISORY
// question (report only, no vote), and a formal DECISION (negotiates to
// unanimity or escalates to a human after 3 rounds). Every decision defaults
// to dry-run — see the note in the propose form.
export default function ExecutiveBoardroom() {
  const [decisions, setDecisions] = useState([]);
  const [selected, setSelected] = useState(null);
  const [form, setForm] = useState({ question: "", proposedAction: "", dependsOn: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const [askQuestion, setAskQuestion] = useState("");
  const [askResult, setAskResult] = useState(null);
  const [askBusy, setAskBusy] = useState(false);

  const [resolveForm, setResolveForm] = useState({ approved: true, rationale: "" });

  async function refresh() {
    const d = await (await fetch("/api/executive/decisions")).json();
    if (d.ok) setDecisions(d.decisions);
  }
  useEffect(() => { refresh(); }, []);

  async function ask() {
    if (!askQuestion.trim()) return;
    setAskBusy(true); setAskResult(null); setError("");
    try {
      const res = await fetch("/api/executive/ask", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question: askQuestion }) });
      const d = await res.json();
      if (!d.ok) setError(d.error);
      else setAskResult(d.result);
    } finally {
      setAskBusy(false);
    }
  }

  async function propose() {
    if (!form.question.trim() || !form.proposedAction.trim()) return;
    setBusy(true); setError("");
    try {
      const id = slugify(form.question);
      const res = await fetch("/api/executive/decisions", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, question: form.question, proposedAction: form.proposedAction, dependsOn: form.dependsOn || null }),
      });
      const d = await res.json();
      if (!d.ok) setError(d.error);
      else { setForm({ question: "", proposedAction: "", dependsOn: "" }); await refresh(); setSelected(d.decision); }
    } finally {
      setBusy(false);
    }
  }

  async function viewDecision(id) {
    const d = await (await fetch(`/api/executive/decisions/${id}`)).json();
    if (d.ok) setSelected(d.decision);
  }

  async function requestSecondOpinion(id) {
    setBusy(true); setError("");
    try {
      const res = await fetch(`/api/executive/decisions/${id}/second-opinion`, { method: "POST" });
      const d = await res.json();
      if (!d.ok) setError(d.error);
      else { await viewDecision(id); await refresh(); }
    } finally {
      setBusy(false);
    }
  }

  async function resolve(id) {
    if (!resolveForm.rationale.trim()) return;
    setBusy(true); setError("");
    try {
      const res = await fetch(`/api/executive/decisions/${id}/resolve`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(resolveForm),
      });
      const d = await res.json();
      if (!d.ok) setError(d.error);
      else { setResolveForm({ approved: true, rationale: "" }); await viewDecision(id); await refresh(); }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ minHeight: "100vh", background: SLATE, color: TEXT, fontFamily: "Inter, system-ui, sans-serif", padding: "24px 28px" }}>
      <div style={{ borderBottom: `1px solid ${LINE}`, paddingBottom: 14, marginBottom: 18 }}>
        <div style={{ fontSize: 11, letterSpacing: 2, color: AMBER, fontFamily: "monospace" }}>AEROLEADAI</div>
        <h1 style={{ fontSize: 22, margin: "4px 0 0" }}>AI Executive Boardroom</h1>
        <p style={{ color: MUTE, fontSize: 12, margin: "4px 0 0", maxWidth: 760 }}>
          CFO, COO, CMO, CLO, and CSO agents analyze real business data and vote on proposed actions. A mandatory-dissent
          "Fifth Business" agent starts every formal decision at NO and must be genuinely convinced — unanimity or a
          human decision, never a majority override. Every proposal runs in dry-run by default: nothing is ever
          auto-executed against the business.
        </p>
      </div>

      {error && <div style={{ background: "#3a1520", border: `1px solid ${RED}`, color: RED, borderRadius: 8, padding: 10, fontSize: 13, marginBottom: 16 }}>{error}</div>}

      <div style={{ background: PANEL, border: `1px solid ${LINE}`, borderRadius: 10, padding: 16, marginBottom: 16 }}>
        <div style={{ fontSize: 11, color: AMBER, fontFamily: "monospace", marginBottom: 10 }}>ASK THE EXECUTIVE TEAM (advisory — no vote, nothing persisted)</div>
        <div style={{ display: "flex", gap: 8 }}>
          <input value={askQuestion} onChange={(e) => setAskQuestion(e.target.value)} placeholder="e.g. How healthy is the business right now?"
            style={{ flex: 1, padding: "8px 10px", background: PANEL2, border: `1px solid ${LINE}`, borderRadius: 6, color: TEXT, fontSize: 13 }} />
          <button onClick={ask} disabled={askBusy} style={{ padding: "8px 16px", background: BLUE, border: "none", borderRadius: 6, color: "#04121f", fontWeight: 700, cursor: "pointer", fontSize: 13 }}>
            {askBusy ? "Convening…" : "Ask"}
          </button>
        </div>
        {askResult && (
          <div style={{ marginTop: 14 }}>
            <div style={{ fontSize: 13, marginBottom: 10 }}>{askResult.synthesis?.executive_summary}</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 8 }}>
              {askResult.agent_recommendations?.map((r) => (
                <div key={r.agent} style={{ background: PANEL2, border: `1px solid ${LINE}`, borderRadius: 8, padding: 10 }}>
                  <div style={{ fontSize: 11, color: AMBER, fontFamily: "monospace" }}>{r.agent}</div>
                  <div style={{ fontSize: 12, marginTop: 4 }}>{r.summary}</div>
                  <div style={{ fontSize: 10, color: MUTE, marginTop: 4, textTransform: "uppercase" }}>risk: {r.risk_level}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1.4fr", gap: 16 }}>
        <div>
          <div style={{ background: PANEL, border: `1px solid ${LINE}`, borderRadius: 10, padding: 16, marginBottom: 16 }}>
            <div style={{ fontSize: 11, color: AMBER, fontFamily: "monospace", marginBottom: 10 }}>PROPOSE A DECISION</div>
            <textarea value={form.question} onChange={(e) => setForm({ ...form, question: e.target.value })} placeholder="Question the boardroom should decide, e.g. Should we raise contractor commission from 65% to 70% in the Twin Cities metro?"
              rows={2} style={{ width: "100%", padding: "8px 10px", background: PANEL2, border: `1px solid ${LINE}`, borderRadius: 6, color: TEXT, fontSize: 13, marginBottom: 8, resize: "vertical" }} />
            <input value={form.proposedAction} onChange={(e) => setForm({ ...form, proposedAction: e.target.value })} placeholder="Proposed action, e.g. Raise contractor commission to 70% in zips 55401-55450"
              style={{ width: "100%", padding: "8px 10px", background: PANEL2, border: `1px solid ${LINE}`, borderRadius: 6, color: TEXT, fontSize: 13, marginBottom: 8 }} />
            <input value={form.dependsOn} onChange={(e) => setForm({ ...form, dependsOn: e.target.value })} placeholder="Depends on decision id (optional)"
              style={{ width: "100%", padding: "8px 10px", background: PANEL2, border: `1px solid ${LINE}`, borderRadius: 6, color: TEXT, fontSize: 13, marginBottom: 10 }} />
            <button onClick={propose} disabled={busy} style={{ padding: "8px 16px", background: AMBER, border: "none", borderRadius: 6, color: "#1a1200", fontWeight: 700, cursor: "pointer", fontSize: 13 }}>
              {busy ? "Negotiating…" : "Propose to Boardroom"}
            </button>
          </div>

          <div style={{ background: PANEL, border: `1px solid ${LINE}`, borderRadius: 10, padding: 16, maxHeight: 480, overflowY: "auto" }}>
            <div style={{ fontSize: 11, color: AMBER, fontFamily: "monospace", marginBottom: 10 }}>DECISIONS ({decisions.length})</div>
            {decisions.length === 0 && <div style={{ fontSize: 12, color: MUTE }}>No decisions yet.</div>}
            {decisions.map((d) => (
              <div key={d.id} onClick={() => viewDecision(d.id)} style={{ cursor: "pointer", padding: "8px 0", borderTop: `1px solid ${LINE}` }}>
                <div style={{ fontSize: 13 }}>{d.question}</div>
                <div style={{ fontSize: 11, color: STATUS_COLOR[d.status] || MUTE, marginTop: 2, textTransform: "uppercase" }}>{d.status.replace(/_/g, " ")}</div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ background: PANEL, border: `1px solid ${LINE}`, borderRadius: 10, padding: 16, maxHeight: 700, overflowY: "auto" }}>
          <div style={{ fontSize: 11, color: AMBER, fontFamily: "monospace", marginBottom: 10 }}>DECISION DETAIL</div>
          {!selected && <div style={{ fontSize: 12, color: MUTE }}>Select a decision to see the full negotiation trail.</div>}
          {selected && (
            <div>
              <div style={{ fontSize: 15, fontWeight: 700 }}>{selected.question}</div>
              <div style={{ fontSize: 12, color: MUTE, marginTop: 2 }}>Proposed: {selected.proposedAction}</div>
              <div style={{ fontSize: 12, color: STATUS_COLOR[selected.status] || MUTE, marginTop: 6, textTransform: "uppercase", fontWeight: 700 }}>{selected.status.replace(/_/g, " ")}</div>

              {selected.result?.synthesis && (
                <div style={{ marginTop: 12, padding: 10, background: PANEL2, borderRadius: 8 }}>
                  <div style={{ fontSize: 11, color: BLUE, marginBottom: 4 }}>CEO SYNTHESIS</div>
                  <div style={{ fontSize: 13 }}>{selected.result.synthesis.executive_summary}</div>
                </div>
              )}

              {selected.result?.agent_recommendations && (
                <div style={{ marginTop: 12 }}>
                  {selected.result.agent_recommendations.map((r) => (
                    <div key={r.agent} style={{ padding: "6px 0", borderTop: `1px solid ${LINE}`, fontSize: 12 }}>
                      <b>{r.agent}</b> — {r.action || "no action proposed"} <span style={{ color: MUTE }}>({Math.round((r.confidence || 0) * 100)}% confidence, {r.risk_level} risk)</span>
                      <div style={{ color: MUTE, marginTop: 2 }}>{r.reasoning}</div>
                    </div>
                  ))}
                </div>
              )}

              {selected.result?.negotiation && (
                <div style={{ marginTop: 12, padding: 10, background: PANEL2, borderRadius: 8 }}>
                  <div style={{ fontSize: 11, color: AMBER, marginBottom: 4 }}>FIFTH BUSINESS NEGOTIATION</div>
                  {selected.result.negotiation.objection_history?.length ? (
                    selected.result.negotiation.objection_history.map((o, i) => <div key={i} style={{ fontSize: 12, marginBottom: 4 }}>{o}</div>)
                  ) : (
                    <div style={{ fontSize: 12, color: MUTE }}>No objections raised — reached agreement without contention.</div>
                  )}
                  {selected.result.negotiation.reason && <div style={{ fontSize: 12, color: RED, marginTop: 6 }}>{selected.result.negotiation.reason}</div>}
                </div>
              )}

              {selected.second_opinion && (
                <div style={{ marginTop: 12, padding: 10, background: PANEL2, borderRadius: 8 }}>
                  <div style={{ fontSize: 11, color: GREEN, marginBottom: 4 }}>SECOND OPINION (informational only)</div>
                  <div style={{ fontSize: 12 }}>{selected.second_opinion.summary}</div>
                </div>
              )}

              {selected.human_resolution && (
                <div style={{ marginTop: 12, padding: 10, background: PANEL2, borderRadius: 8 }}>
                  <div style={{ fontSize: 11, color: TEXT, marginBottom: 4 }}>HUMAN RESOLUTION</div>
                  <div style={{ fontSize: 12 }}>{selected.human_resolution.approved ? "Approved" : "Rejected"} — {selected.human_resolution.rationale}</div>
                </div>
              )}

              {selected.status === "escalated" && (
                <div style={{ marginTop: 16, borderTop: `1px solid ${LINE}`, paddingTop: 12 }}>
                  <button onClick={() => requestSecondOpinion(selected.id)} disabled={busy} style={{ padding: "6px 12px", background: "transparent", border: `1px solid ${GREEN}`, borderRadius: 6, color: GREEN, cursor: "pointer", fontSize: 12, marginBottom: 10 }}>
                    Request second opinion
                  </button>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
                    <select value={resolveForm.approved ? "approve" : "reject"} onChange={(e) => setResolveForm({ ...resolveForm, approved: e.target.value === "approve" })}
                      style={{ padding: "6px 10px", background: PANEL2, border: `1px solid ${LINE}`, borderRadius: 6, color: TEXT, fontSize: 12 }}>
                      <option value="approve">Approve</option>
                      <option value="reject">Reject</option>
                    </select>
                    <input value={resolveForm.rationale} onChange={(e) => setResolveForm({ ...resolveForm, rationale: e.target.value })} placeholder="Rationale for the record"
                      style={{ flex: 1, padding: "6px 10px", background: PANEL2, border: `1px solid ${LINE}`, borderRadius: 6, color: TEXT, fontSize: 12 }} />
                    <button onClick={() => resolve(selected.id)} disabled={busy} style={{ padding: "6px 12px", background: AMBER, border: "none", borderRadius: 6, color: "#1a1200", fontWeight: 700, cursor: "pointer", fontSize: 12 }}>Resolve</button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
