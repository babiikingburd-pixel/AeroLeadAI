"use client";
import { useEffect, useState } from "react";
import { loadLeads, importConsoleProperties, setLeadStatus, setFollowUp, LEAD_STATUSES } from "../lib/leadStore";
import { downloadCsv, overdueFollowUps, optimizeRoute, routeToGoogleMapsUrl } from "../lib/crm";
import LeadDetailDrawer from "./LeadDetailDrawer";

const AMBER = "#f5a623", PANEL = "#141b26", LINE = "#232f3e", MUTE = "#6b7c93", GREEN = "#4caf7d", BLUE = "#2e7dd1", RED = "#e5534b";

export default function CrmPanel() {
  const [leads, setLeads] = useState([]);
  const [syncMsg, setSyncMsg] = useState("");
  const [selected, setSelected] = useState(null);
  const refresh = () => setLeads(loadLeads());

  useEffect(() => { setLeads(importConsoleProperties()); }, []);

  const overdue = overdueFollowUps(leads);

  function optimize() {
    const route = optimizeRoute(leads.filter((l) => !["won", "lost"].includes(l.status || "new")));
    if (route.length < 2) { setSyncMsg("Need at least 2 leads with coordinates to build a route."); return; }
    window.open(routeToGoogleMapsUrl(route), "_blank");
  }

  async function sync() {
    setSyncMsg("Syncing…");
    try {
      const res = await fetch("/api/crm-sync", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ leads: leads.map(({ imagery, ...l }) => l) }) });
      const d = await res.json();
      setSyncMsg(d.ok ? `Synced ${d.count}: ${JSON.stringify(d.results)}` : d.error);
    } catch (e) { setSyncMsg("Sync failed: " + e.message); }
  }

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: 20, fontFamily: "Inter, system-ui, sans-serif", color: "#dfe6ee" }}>
      <div style={{ fontSize: 12, fontFamily: "monospace", color: AMBER, marginBottom: 12 }}>CRM &amp; WORKFLOW</div>

      {overdue.length > 0 && (
        <div style={{ background: "#2a1418", border: `1px solid ${RED}`, borderRadius: 8, padding: "10px 14px", marginBottom: 12, fontSize: 13 }}>
          🔔 {overdue.length} follow-up{overdue.length > 1 ? "s" : ""} overdue: {overdue.slice(0, 3).map((l) => l.address).join(" · ")}{overdue.length > 3 ? " …" : ""}
        </div>
      )}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
        <button onClick={() => downloadCsv(leads)} style={{ padding: "8px 14px", background: AMBER, border: "none", borderRadius: 6, color: "#1a1200", fontWeight: 700, cursor: "pointer", fontSize: 13 }}>⬇ Export CSV</button>
        <button onClick={optimize} style={{ padding: "8px 14px", background: "transparent", border: `1px solid ${BLUE}`, borderRadius: 6, color: BLUE, cursor: "pointer", fontSize: 13 }}>🗺 Optimize canvassing route</button>
        <button onClick={sync} style={{ padding: "8px 14px", background: "transparent", border: `1px solid ${GREEN}`, borderRadius: 6, color: GREEN, cursor: "pointer", fontSize: 13 }}>↗ Sync to HubSpot / Salesforce</button>
        {syncMsg && <span style={{ alignSelf: "center", fontSize: 12, color: MUTE }}>{syncMsg}</span>}
      </div>

      <div style={{ background: PANEL, border: `1px solid ${LINE}`, borderRadius: 10, overflow: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ color: MUTE, fontSize: 11, textTransform: "uppercase", letterSpacing: 1 }}>
              {["Address", "Score", "Status", "Follow-up"].map((h) => <th key={h} style={{ textAlign: "left", padding: "10px 14px", borderBottom: `1px solid ${LINE}` }}>{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {leads.length === 0 && <tr><td colSpan={4} style={{ padding: 16, color: MUTE }}>No leads yet — scan properties and they appear here automatically.</td></tr>}
            {leads.map((l, i) => {
              const late = l.followUp && new Date(l.followUp) <= new Date() && !["won", "lost"].includes(l.status || "new");
              return (
                <tr key={i} style={{ borderTop: `1px solid ${LINE}` }}>
                  <td style={{ padding: "8px 14px" }}>
                    <button onClick={() => setSelected(l)} style={{ background: "none", border: "none", color: "#dfe6ee", cursor: "pointer", textDecoration: "underline", textDecorationColor: LINE, fontSize: 13, padding: 0, textAlign: "left" }}>{l.address}</button>
                  </td>
                  <td style={{ padding: "8px 14px", fontWeight: 700, color: (l.findingsScore ?? 0) >= 50 ? AMBER : GREEN }}>{l.findingsScore ?? "—"}</td>
                  <td style={{ padding: "8px 14px" }}>
                    <select value={l.status || "new"} onChange={(e) => { setLeadStatus(l.address, e.target.value); refresh(); }}
                      style={{ padding: "4px 8px", background: "#0b0f16", border: `1px solid ${LINE}`, borderRadius: 6, color: "#dfe6ee", fontSize: 12 }}>
                      {LEAD_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </td>
                  <td style={{ padding: "8px 14px" }}>
                    <input type="date" value={l.followUp ? l.followUp.slice(0, 10) : ""} onChange={(e) => { setFollowUp(l.address, e.target.value ? new Date(e.target.value).toISOString() : null); refresh(); }}
                      style={{ padding: "4px 8px", background: "#0b0f16", border: `1px solid ${late ? RED : LINE}`, borderRadius: 6, color: late ? RED : "#dfe6ee", fontSize: 12 }} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {selected && <LeadDetailDrawer lead={selected} onClose={() => setSelected(null)} onChange={() => { refresh(); setSelected(loadLeads().find((l) => l.address === selected.address) || null); }} />}
    </div>
  );
}
