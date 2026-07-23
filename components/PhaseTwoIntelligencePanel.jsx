"use client";
import { useEffect, useState } from "react";

const PANEL = "#131c2b", LINE = "#22304a", MUTE = "#77839a";
const AMBER = "#f5b942", BLUE = "#4fa3e3", GREEN = "#4fc98e";
const CONF_COLOR = { high: GREEN, medium: AMBER, low: MUTE };

// Strategic Advisor (#17), Contractor Growth Engine (#10), and National
// Expansion Playbook (#18) surfaced together — all three are naturally
// low-confidence/sparse until real volume exists, which each panel says
// plainly rather than hiding.
export default function PhaseTwoIntelligencePanel() {
  const [advisor, setAdvisor] = useState(null);
  const [candidates, setCandidates] = useState([]);
  const [launches, setLaunches] = useState([]);

  useEffect(() => {
    fetch("/api/advisor/recommendations").then((r) => r.json()).then((d) => d.ok && setAdvisor(d));
    fetch("/api/growth/candidates?status=pending_verification").then((r) => r.json()).then((d) => d.ok && setCandidates(d.candidates));
    fetch("/api/expansion/regions").then((r) => r.json()).then((d) => d.ok && setLaunches(d.launches));
  }, []);

  async function verify(id) {
    await fetch("/api/growth/verify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ candidateId: id }) });
    const d = await (await fetch("/api/growth/candidates?status=pending_verification")).json();
    if (d.ok) setCandidates(d.candidates);
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16, marginTop: 16 }}>
      <div style={{ background: PANEL, border: `1px solid ${LINE}`, borderRadius: 10, padding: 16 }}>
        <div style={{ fontSize: 11, color: AMBER, fontFamily: "monospace", marginBottom: 10 }}>STRATEGIC ADVISOR</div>
        {!advisor && <div style={{ fontSize: 12, color: MUTE }}>Loading…</div>}
        {advisor && [advisor.recruitment, advisor.marketEntry, advisor.roi].map((r, i) => (
          <div key={i} style={{ fontSize: 12, padding: "6px 0", borderTop: i ? `1px solid ${LINE}` : "none" }}>
            <span style={{ color: CONF_COLOR[r.confidence], fontWeight: 700, textTransform: "uppercase", fontSize: 10 }}>{r.confidence} confidence</span>
            <div style={{ marginTop: 2 }}>{r.recommendation}</div>
          </div>
        ))}
      </div>

      <div style={{ background: PANEL, border: `1px solid ${LINE}`, borderRadius: 10, padding: 16, maxHeight: 260, overflowY: "auto" }}>
        <div style={{ fontSize: 11, color: AMBER, fontFamily: "monospace", marginBottom: 10 }}>CONTRACTOR GROWTH — PENDING VERIFICATION ({candidates.length})</div>
        {candidates.length === 0 && <div style={{ fontSize: 12, color: MUTE }}>No pending candidates. Submit one via POST /api/growth/candidates.</div>}
        {candidates.map((c) => (
          <div key={c.id} style={{ fontSize: 12, padding: "6px 0", borderTop: `1px solid ${LINE}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span>{c.business_name}</span>
            <button onClick={() => verify(c.id)} style={{ padding: "3px 8px", background: "transparent", border: `1px solid ${BLUE}`, borderRadius: 5, color: BLUE, fontSize: 11, cursor: "pointer" }}>Verify</button>
          </div>
        ))}
      </div>

      <div style={{ background: PANEL, border: `1px solid ${LINE}`, borderRadius: 10, padding: 16, maxHeight: 260, overflowY: "auto" }}>
        <div style={{ fontSize: 11, color: AMBER, fontFamily: "monospace", marginBottom: 10 }}>EXPANSION PLAYBOOK ({launches.length})</div>
        {launches.length === 0 && <div style={{ fontSize: 12, color: MUTE }}>No region launches tracked yet.</div>}
        {launches.map((l) => (
          <div key={l.id} style={{ fontSize: 12, padding: "6px 0", borderTop: `1px solid ${LINE}` }}>
            <b>{l.region_name}</b> — {l.checklist.filter((c) => c.done).length}/{l.checklist.length} steps <span style={{ color: MUTE }}>({l.status})</span>
          </div>
        ))}
      </div>
    </div>
  );
}
