"use client";
import { useEffect, useMemo, useState } from "react";
import { loadLeads, importConsoleProperties, LEAD_STATUSES } from "../lib/leadStore";
import ConfidenceCard from "./ConfidenceCard";
import LeadDetailDrawer from "./LeadDetailDrawer";

const AMBER = "#f5a623", PANEL = "#141b26", LINE = "#232f3e", MUTE = "#6b7c93", GREEN = "#4caf7d", BLUE = "#2e7dd1", RED = "#e5534b";
const AVG_JOB_VALUE = 12000; // typical full-roof replacement; adjust in one place
const CONF_PCT = { low: 45, medium: 70, high: 90 };

function Kpi({ label, value, sub, color = "#dfe6ee" }) {
  return (
    <div style={{ background: PANEL, border: `1px solid ${LINE}`, borderRadius: 10, padding: 16, minWidth: 150, flex: 1 }}>
      <div style={{ fontSize: 11, color: MUTE, textTransform: "uppercase", letterSpacing: 1 }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 800, color, marginTop: 4 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: MUTE, marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function BarChart({ title, data }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div style={{ background: PANEL, border: `1px solid ${LINE}`, borderRadius: 10, padding: 16, flex: 1, minWidth: 280 }}>
      <div style={{ fontSize: 11, color: MUTE, textTransform: "uppercase", letterSpacing: 1, marginBottom: 10 }}>{title}</div>
      {data.map((d) => (
        <div key={d.label} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
          <span style={{ width: 90, fontSize: 12, color: "#9fb0c3" }}>{d.label}</span>
          <div style={{ flex: 1, background: "#0b0f16", borderRadius: 4, height: 14 }}>
            <div style={{ width: `${(d.value / max) * 100}%`, height: "100%", background: d.color || BLUE, borderRadius: 4 }} />
          </div>
          <span style={{ width: 30, fontSize: 12, color: "#dfe6ee", textAlign: "right" }}>{d.value}</span>
        </div>
      ))}
    </div>
  );
}

export default function Dashboard() {
  const [leads, setLeads] = useState([]);
  const [minScore, setMinScore] = useState(0);
  const [statusFilter, setStatusFilter] = useState("all");
  const [selected, setSelected] = useState(null);

  useEffect(() => { setLeads(importConsoleProperties()); }, []);

  const filtered = useMemo(() => leads.filter((l) =>
    (l.findingsScore ?? 0) >= minScore && (statusFilter === "all" || (l.status || "new") === statusFilter)
  ), [leads, minScore, statusFilter]);

  const scanned = leads.length;
  const damaged = leads.filter((l) => (l.findingsScore ?? 0) >= 50).length;
  const active = leads.filter((l) => !["won", "lost"].includes(l.status || "new")).length;
  const scoredLeads = leads.filter((l) => l.scoring?.estimated_repair_value_usd);
  // Revenue forecasting: risk-adjust each AI-scored lead's estimated repair
  // value by its insurance-claim probability; fall back to a flat
  // avg-job-value estimate for leads that haven't been AI-scored yet.
  const revenue = scoredLeads.length
    ? Math.round(scoredLeads.reduce((sum, l) => sum + (l.scoring.estimated_repair_value_usd * (l.scoring.insurance_claim_probability_pct || 50) / 100), 0)
        + (damaged - scoredLeads.length) * AVG_JOB_VALUE * 0.5)
    : damaged * AVG_JOB_VALUE;
  const confs = leads.map((l) => CONF_PCT[l.confidence]).filter(Boolean);
  const avgConf = confs.length ? Math.round(confs.reduce((a, b) => a + b, 0) / confs.length) : null;

  const scoreDist = [
    { label: "Severe 75+", value: leads.filter((l) => (l.findingsScore ?? -1) >= 75).length, color: RED },
    { label: "High 50-74", value: leads.filter((l) => l.findingsScore >= 50 && l.findingsScore < 75).length, color: AMBER },
    { label: "Moderate 25-49", value: leads.filter((l) => l.findingsScore >= 25 && l.findingsScore < 50).length, color: BLUE },
    { label: "Low 0-24", value: leads.filter((l) => l.findingsScore != null && l.findingsScore < 25).length, color: GREEN },
  ];
  const statusDist = LEAD_STATUSES.map((s) => ({ label: s, value: leads.filter((l) => (l.status || "new") === s).length }));

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: 20, fontFamily: "Inter, system-ui, sans-serif", color: "#dfe6ee" }}>
      <div style={{ fontSize: 12, fontFamily: "monospace", color: AMBER, marginBottom: 12 }}>OPERATIONS DASHBOARD</div>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
        <Kpi label="Properties scanned" value={scanned} />
        <Kpi label="Damage detected" value={damaged} sub="score ≥ 50" color={damaged ? AMBER : "#dfe6ee"} />
        <Kpi label="Active leads" value={active} color={BLUE} />
        <Kpi label="Est. pipeline revenue" value={`$${revenue.toLocaleString()}`} sub={scoredLeads.length ? `risk-adjusted, ${scoredLeads.length} AI-scored` : `${damaged} × $${AVG_JOB_VALUE.toLocaleString()} avg job (unscored)`} color={GREEN} />
        <Kpi label="Avg AI confidence" value={avgConf != null ? `${avgConf}%` : "—"} />
      </div>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
        <BarChart title="Damage score distribution" data={scoreDist} />
        <BarChart title="Lead status" data={statusDist} />
      </div>

      <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 10, flexWrap: "wrap" }}>
        <label style={{ fontSize: 12, color: MUTE }}>Min score
          <input type="range" min={0} max={100} value={minScore} onChange={(e) => setMinScore(+e.target.value)} style={{ marginLeft: 8, verticalAlign: "middle" }} />
          <span style={{ marginLeft: 6, color: "#dfe6ee" }}>{minScore}</span>
        </label>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
          style={{ padding: "6px 10px", background: PANEL, border: `1px solid ${LINE}`, borderRadius: 6, color: "#dfe6ee", fontSize: 12 }}>
          <option value="all">All statuses</option>
          {LEAD_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <span style={{ fontSize: 12, color: MUTE }}>{filtered.length} shown</span>
      </div>

      <div style={{ background: PANEL, border: `1px solid ${LINE}`, borderRadius: 10, overflow: "hidden", marginBottom: 16 }}>
        {filtered.length === 0 && <div style={{ padding: 16, fontSize: 13, color: MUTE }}>No leads match. Scan properties in the Console or Background Scanner and they'll appear here automatically.</div>}
        {filtered.map((l, i) => (
          <button key={i} onClick={() => setSelected(l)} style={{ display: "flex", width: "100%", textAlign: "left", gap: 12, alignItems: "center", padding: "10px 14px", background: "transparent", border: "none", borderTop: i ? `1px solid ${LINE}` : "none", color: "#dfe6ee", cursor: "pointer", fontSize: 13 }}>
            <span style={{ flex: 1 }}>{l.address}</span>
            <span style={{ fontSize: 11, color: MUTE }}>{l.status || "new"}</span>
            <span style={{ fontWeight: 700, color: (l.findingsScore ?? 0) >= 50 ? AMBER : GREEN, width: 40, textAlign: "right" }}>{l.findingsScore ?? "—"}</span>
          </button>
        ))}
      </div>

      {selected && <LeadDetailDrawer lead={selected} onClose={() => setSelected(null)} onChange={() => { const fresh = importConsoleProperties(); setLeads(fresh); setSelected(fresh.find((l) => l.address === selected.address) || null); }} />}
    </div>
  );
}
