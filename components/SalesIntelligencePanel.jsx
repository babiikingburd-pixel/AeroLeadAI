"use client";
import { useState } from "react";
import { upsertLead } from "../lib/leadStore";

const AMBER = "#f5a623", PANEL = "#141b26", LINE = "#232f3e", MUTE = "#6b7c93", GREEN = "#4caf7d", RED = "#e5534b", BLUE = "#2e7dd1";
const RANK_COLOR = { hot: RED, warm: AMBER, cool: BLUE, cold: MUTE };

// AI Lead Scoring & Sales Intelligence: roof age estimate, damage severity,
// insurance claim probability, estimated repair value, priority rank, and a
// revenue forecast note — computed from the property's existing findings.
export default function SalesIntelligencePanel({ lead, onScored }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const scoring = lead.scoring;

  async function score() {
    setBusy(true); setErr("");
    try {
      const res = await fetch("/api/lead-score", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          address: lead.address, findingsScore: lead.findingsScore, indicators: lead.indicators,
          notes: lead.notes, buildingAge: lead.buildingAge, roofType: lead.roofType,
          permitWithin10y: lead.lowPriority, weatherSummary: lead.weatherSummary,
        }),
      });
      const data = await res.json();
      if (data.error) { setErr(data.error); return; }
      upsertLead({ address: lead.address, scoring: data });
      onScored?.(data);
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  }

  return (
    <div style={{ background: PANEL, border: `1px solid ${LINE}`, borderRadius: 10, padding: 16, marginTop: 12 }}>
      <div style={{ fontSize: 12, fontFamily: "monospace", color: AMBER, marginBottom: 10 }}>AI LEAD SCORING &amp; SALES INTELLIGENCE</div>
      {!scoring && (
        <button onClick={score} disabled={busy} style={{ padding: "8px 14px", background: busy ? MUTE : AMBER, border: "none", borderRadius: 6, color: "#1a1200", fontWeight: 700, cursor: busy ? "default" : "pointer", fontSize: 13 }}>
          {busy ? "Scoring…" : "Score this lead"}
        </button>
      )}
      {err && <div style={{ fontSize: 12, color: RED, marginTop: 8 }}>{err}</div>}
      {scoring && (
        <div>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 10 }}>
            <div><div style={{ fontSize: 11, color: MUTE }}>Priority</div><div style={{ fontSize: 18, fontWeight: 800, color: RANK_COLOR[scoring.lead_priority_rank] || MUTE, textTransform: "uppercase" }}>{scoring.lead_priority_rank}</div></div>
            <div><div style={{ fontSize: 11, color: MUTE }}>Insurance claim probability</div><div style={{ fontSize: 18, fontWeight: 800 }}>{scoring.insurance_claim_probability_pct}%</div></div>
            <div><div style={{ fontSize: 11, color: MUTE }}>Est. repair value</div><div style={{ fontSize: 18, fontWeight: 800, color: GREEN }}>${(scoring.estimated_repair_value_usd || 0).toLocaleString()}</div></div>
            <div><div style={{ fontSize: 11, color: MUTE }}>Roof age est.</div><div style={{ fontSize: 18, fontWeight: 800 }}>{scoring.roof_age_estimate_years ?? "—"} yrs</div></div>
          </div>
          {scoring.revenue_forecast_note && <div style={{ fontSize: 12, color: "#9fb0c3", fontStyle: "italic", marginBottom: 6 }}>{scoring.revenue_forecast_note}</div>}
          {scoring.reasoning && <div style={{ fontSize: 11, color: MUTE }}>Key factor: {scoring.reasoning}</div>}
          <button onClick={score} disabled={busy} style={{ marginTop: 10, padding: "6px 12px", background: "transparent", border: `1px solid ${LINE}`, borderRadius: 6, color: MUTE, cursor: "pointer", fontSize: 12 }}>{busy ? "Re-scoring…" : "Re-score"}</button>
        </div>
      )}
    </div>
  );
}
