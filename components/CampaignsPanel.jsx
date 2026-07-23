"use client";
import { useEffect, useState } from "react";

const AMBER = "#f5a623", PANEL = "#141b26", PANEL2 = "#0f141d", LINE = "#232f3e", MUTE = "#6b7c93", GREEN = "#4caf7d", BLUE = "#2e7dd1";

// AI Sales & Marketing Engine (#11) — campaign records + a budget-
// reallocation signal computed from real lead conversion. Actually placing
// ad spend needs GOOGLE_ADS_API_KEY/META_ADS_API_KEY (not configured);
// nurture follow-ups need SMS_PROVIDER_API_KEY — both run as a real, honest
// no-op logged server-side until those exist.
export default function CampaignsPanel() {
  const [campaigns, setCampaigns] = useState([]);
  const [reallocation, setReallocation] = useState(null);
  const [form, setForm] = useState({ name: "", channel: "sms", targetZipCodes: "", budgetCents: "" });
  const [msg, setMsg] = useState("");

  async function refresh() {
    const res = await fetch("/api/marketing/campaigns");
    const d = await res.json();
    if (d.ok) setCampaigns(d.campaigns);
  }
  useEffect(() => { refresh(); }, []);

  async function launch() {
    if (!form.name.trim()) return;
    setMsg("Launching…");
    const res = await fetch("/api/marketing/campaigns", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: form.name, channel: form.channel,
        targetZipCodes: form.targetZipCodes.split(",").map((z) => z.trim()).filter(Boolean),
        budgetCents: form.budgetCents ? Math.round(parseFloat(form.budgetCents) * 100) : null,
      }),
    });
    const d = await res.json();
    setMsg(d.ok ? "Campaign launched." : d.error);
    if (d.ok) { setForm({ name: "", channel: "sms", targetZipCodes: "", budgetCents: "" }); refresh(); }
  }

  async function checkReallocation() {
    const res = await fetch("/api/marketing/campaigns?reallocation=1");
    const d = await res.json();
    if (d.ok) setReallocation(d);
  }

  return (
    <div style={{ background: PANEL, border: `1px solid ${LINE}`, borderRadius: 10, padding: 16, marginTop: 20 }}>
      <div style={{ fontSize: 12, fontFamily: "monospace", color: AMBER, marginBottom: 10 }}>MARKETING CAMPAIGNS</div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Campaign name"
          style={{ padding: "7px 10px", background: PANEL2, border: `1px solid ${LINE}`, borderRadius: 6, color: "#dfe6ee", fontSize: 13, flex: 1, minWidth: 140 }} />
        <select value={form.channel} onChange={(e) => setForm({ ...form, channel: e.target.value })} style={{ padding: "7px 10px", background: PANEL2, border: `1px solid ${LINE}`, borderRadius: 6, color: "#dfe6ee", fontSize: 13 }}>
          {["sms", "email", "google_ads", "meta_ads", "direct_mail"].map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <input value={form.targetZipCodes} onChange={(e) => setForm({ ...form, targetZipCodes: e.target.value })} placeholder="ZIPs, comma-separated"
          style={{ padding: "7px 10px", background: PANEL2, border: `1px solid ${LINE}`, borderRadius: 6, color: "#dfe6ee", fontSize: 13, width: 160 }} />
        <input value={form.budgetCents} onChange={(e) => setForm({ ...form, budgetCents: e.target.value })} placeholder="Budget $" type="number"
          style={{ padding: "7px 10px", background: PANEL2, border: `1px solid ${LINE}`, borderRadius: 6, color: "#dfe6ee", fontSize: 13, width: 100 }} />
        <button onClick={launch} style={{ padding: "7px 14px", background: AMBER, border: "none", borderRadius: 6, color: "#1a1200", fontWeight: 700, cursor: "pointer", fontSize: 13 }}>Launch</button>
      </div>
      {msg && <div style={{ fontSize: 12, color: MUTE, marginBottom: 10 }}>{msg}</div>}

      {campaigns.length === 0 ? (
        <div style={{ fontSize: 12, color: MUTE }}>No campaigns yet.</div>
      ) : (
        campaigns.map((c) => (
          <div key={c.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "6px 0", borderTop: `1px solid ${LINE}` }}>
            <span>{c.name} <span style={{ color: MUTE }}>({c.channel})</span></span>
            <span style={{ color: MUTE }}>{c.status}{c.budget_cents ? ` · $${(c.budget_cents / 100).toLocaleString()}` : ""}</span>
          </div>
        ))
      )}

      <button onClick={checkReallocation} style={{ marginTop: 10, padding: "6px 12px", background: "transparent", border: `1px solid ${BLUE}`, borderRadius: 6, color: BLUE, cursor: "pointer", fontSize: 12 }}>Check budget reallocation signal</button>
      {reallocation && <div style={{ fontSize: 12, color: GREEN, marginTop: 8 }}>{reallocation.recommendation}</div>}
    </div>
  );
}
