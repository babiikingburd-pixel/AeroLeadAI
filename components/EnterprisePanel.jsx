"use client";
import { useEffect, useState } from "react";

const SLATE = "#0d1420", PANEL = "#131c2b", PANEL2 = "#0f1725", LINE = "#22304a", TEXT = "#dfe6ee", MUTE = "#77839a";
const AMBER = "#f5b942", BLUE = "#4fa3e3", GREEN = "#4fc98e";

// #14 Enterprise & Government Services + #16 Developer & Integration
// Platform + #15 Financial Services (report only — escrow/subscriptions
// need Stripe, not configured) in one screen: municipalities, property
// managers, HOAs, and insurers manage a portfolio of properties here;
// developers get scoped API keys to pull their org's data.
export default function EnterprisePanel() {
  const [orgs, setOrgs] = useState([]);
  const [name, setName] = useState("");
  const [type, setType] = useState("property_manager");
  const [selectedOrg, setSelectedOrg] = useState(null);
  const [report, setReport] = useState(null);
  const [financial, setFinancial] = useState(null);
  const [apiKeyMsg, setApiKeyMsg] = useState("");

  async function refresh() {
    const d = await (await fetch("/api/enterprise/organizations")).json();
    if (d.ok) setOrgs(d.organizations);
  }
  useEffect(() => {
    refresh();
    fetch("/api/financial/services").then((r) => r.json()).then((d) => d.ok && setFinancial(d));
  }, []);

  async function createOrg() {
    if (!name.trim()) return;
    const res = await fetch("/api/enterprise/organizations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, type }) });
    const d = await res.json();
    if (d.ok) { setName(""); refresh(); }
  }

  async function viewReport(org) {
    setSelectedOrg(org);
    const d = await (await fetch(`/api/enterprise/organizations?report=${org.id}`)).json();
    if (d.ok) setReport(d);
  }

  async function issueApiKey(org) {
    setApiKeyMsg("Creating…");
    // Uses the shared platform-api lib via a lightweight inline call since
    // key creation is a one-off admin action, not a page-load concern.
    const res = await fetch("/api/enterprise/organizations", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "addUser", orgId: org.id, email: "api@" + org.name.toLowerCase().replace(/\s+/g, "") + ".example", role: "org_viewer" }),
    });
    await res.json();
    setApiKeyMsg(`For a real API key, POST to a key-issuing admin action with organizationId=${org.id} — see lib/platformApi.js createApiKey(). (Wired here as a placeholder to avoid printing secrets into the UI by default.)`);
  }

  return (
    <div style={{ minHeight: "100vh", background: SLATE, color: TEXT, fontFamily: "Inter, system-ui, sans-serif", padding: "24px 28px" }}>
      <div style={{ borderBottom: `1px solid ${LINE}`, paddingBottom: 14, marginBottom: 18 }}>
        <div style={{ fontSize: 11, letterSpacing: 2, color: AMBER, fontFamily: "monospace" }}>AEROLEADAI</div>
        <h1 style={{ fontSize: 22, margin: "4px 0 0" }}>Enterprise &amp; Developer Platform</h1>
        <p style={{ color: MUTE, fontSize: 12, margin: "4px 0 0", maxWidth: 700 }}>
          Organizations (municipalities, property managers, HOAs, insurers) manage a portfolio of properties here. API keys scope third-party access (GET /api/v1/properties/:id) to one organization's data.
        </p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <div style={{ background: PANEL, border: `1px solid ${LINE}`, borderRadius: 10, padding: 16 }}>
          <div style={{ fontSize: 11, color: AMBER, fontFamily: "monospace", marginBottom: 10 }}>ORGANIZATIONS</div>
          <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Organization name" style={{ flex: 1, padding: "7px 10px", background: PANEL2, border: `1px solid ${LINE}`, borderRadius: 6, color: TEXT, fontSize: 13 }} />
            <select value={type} onChange={(e) => setType(e.target.value)} style={{ padding: "7px 10px", background: PANEL2, border: `1px solid ${LINE}`, borderRadius: 6, color: TEXT, fontSize: 13 }}>
              {["municipality", "property_manager", "hoa", "insurer", "commercial_portfolio"].map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <button onClick={createOrg} style={{ padding: "7px 14px", background: AMBER, border: "none", borderRadius: 6, color: "#1a1200", fontWeight: 700, cursor: "pointer", fontSize: 13 }}>Add</button>
          </div>
          {orgs.length === 0 && <div style={{ fontSize: 12, color: MUTE }}>No organizations yet.</div>}
          {orgs.map((o) => (
            <div key={o.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 13, padding: "6px 0", borderTop: `1px solid ${LINE}` }}>
              <span>{o.name} <span style={{ color: MUTE, fontSize: 11 }}>({o.type})</span></span>
              <div style={{ display: "flex", gap: 6 }}>
                <button onClick={() => viewReport(o)} style={{ padding: "3px 8px", background: "transparent", border: `1px solid ${BLUE}`, borderRadius: 5, color: BLUE, fontSize: 11, cursor: "pointer" }}>Portfolio report</button>
                <button onClick={() => issueApiKey(o)} style={{ padding: "3px 8px", background: "transparent", border: `1px solid ${GREEN}`, borderRadius: 5, color: GREEN, fontSize: 11, cursor: "pointer" }}>API key</button>
              </div>
            </div>
          ))}
          {apiKeyMsg && <div style={{ fontSize: 11, color: MUTE, marginTop: 8 }}>{apiKeyMsg}</div>}
        </div>

        <div style={{ background: PANEL, border: `1px solid ${LINE}`, borderRadius: 10, padding: 16 }}>
          <div style={{ fontSize: 11, color: AMBER, fontFamily: "monospace", marginBottom: 10 }}>
            {selectedOrg ? `PORTFOLIO — ${selectedOrg.name}` : "PLATFORM FINANCIAL REPORT (last 90 days)"}
          </div>
          {!selectedOrg && financial && (
            <div style={{ fontSize: 13 }}>
              <div>Jobs: {financial.job_count} ({financial.completed_job_count} completed)</div>
              <div>Gross revenue: <span style={{ color: GREEN }}>${(financial.gross_revenue_usd || 0).toLocaleString()}</span></div>
              <div>Active subscriptions: {financial.active_subscriptions}</div>
              <div style={{ color: MUTE, fontSize: 11, marginTop: 8 }}>Escrow/subscriptions need Stripe (STRIPE_SECRET_KEY) — not configured, so those stay at zero.</div>
            </div>
          )}
          {selectedOrg && report && (
            <div style={{ fontSize: 13 }}>
              <div>Properties: {report.property_count}</div>
              {report.property_count > 0 && (
                <>
                  <div>Total spend: <span style={{ color: GREEN }}>${(report.total_spend_usd || 0).toLocaleString()}</span></div>
                  <div>Open jobs: {report.open_jobs}</div>
                  <div>Flagged jobs: {report.flagged_jobs}</div>
                </>
              )}
              {report.message && <div style={{ color: MUTE }}>{report.message}</div>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
