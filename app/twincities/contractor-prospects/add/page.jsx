"use client";
import { useState } from "react";
import { HUD } from "../../../../lib/hudTheme";

export default function AddContractorPage() {
  const [businessName, setBusinessName] = useState("");
  const [locationHint, setLocationHint] = useState("");
  const [website, setWebsite] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  async function runDeepSearch() {
    if (!businessName.trim() || !locationHint.trim()) {
      setError("Business name and a location are both required.");
      return;
    }
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/contractor-prospects/discover", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ businessName: businessName.trim(), locationHint: locationHint.trim(), website: website.trim() }),
      });
      const data = await res.json();
      if (data.ok) setResult(data);
      else setError(data.error || "Deep search failed.");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  const inputStyle = {
    width: "100%", padding: "10px 12px", background: "transparent", border: `1px solid ${HUD.lineDim}`,
    borderRadius: 4, color: HUD.ice, fontSize: 13, fontFamily: HUD.fontMono, boxSizing: "border-box",
  };
  const labelStyle = { fontSize: 11, color: HUD.muted, letterSpacing: "0.05em", textTransform: "uppercase", marginBottom: 6, display: "block" };

  return (
    <div style={{ minHeight: "100vh", background: HUD.bg, color: HUD.ice, fontFamily: HUD.fontMono, padding: 24, maxWidth: 640, margin: "0 auto" }}>
      <a href="/twincities/contractor-prospects" style={{ color: HUD.cyan }}>← Contractor Prospect Bench</a>
      <h1 style={{ color: HUD.cyan, fontFamily: HUD.fontDisplay, marginTop: 12 }}>ADD CONTRACTOR — DEEP SEARCH</h1>
      <p style={{ color: HUD.muted, fontSize: 12, lineHeight: 1.6 }}>
        Enter any roofing company name and where they're based. This geocodes the location (free, no API key),
        attempts to locate the business itself in public map data, then builds a real service area from actual
        properties in the database within 12 miles — not a guessed or fabricated city list.
      </p>

      <div style={{ marginTop: 20, display: "flex", flexDirection: "column", gap: 16 }}>
        <div>
          <label style={labelStyle}>Company name *</label>
          <input style={inputStyle} value={businessName} onChange={(e) => setBusinessName(e.target.value)} placeholder="e.g. Northland Roofing & Exteriors" />
        </div>
        <div>
          <label style={labelStyle}>City, or full address *</label>
          <input style={inputStyle} value={locationHint} onChange={(e) => setLocationHint(e.target.value)} placeholder="e.g. Burnsville, MN — or a full street address for best accuracy" />
        </div>
        <div>
          <label style={labelStyle}>Website (optional)</label>
          <input style={inputStyle} value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://…" />
        </div>
        <button
          onClick={runDeepSearch}
          disabled={busy}
          style={{
            padding: "12px 18px", background: busy ? "transparent" : "rgba(255,190,80,0.08)",
            border: `1px solid ${HUD.amber}`, color: HUD.amber, borderRadius: 4,
            cursor: busy ? "default" : "pointer", fontWeight: 700, fontSize: 13, opacity: busy ? 0.6 : 1,
          }}
        >
          {busy ? "🔎 Deep searching…" : "🔎 Run Deep Search →"}
        </button>
      </div>

      {error && (
        <div style={{ marginTop: 20, padding: 14, border: `1px solid ${HUD.red}`, borderRadius: 4, color: HUD.red, fontSize: 13 }}>
          {error}
        </div>
      )}

      {result && (
        <div style={{ marginTop: 20, padding: 16, border: `1px solid ${HUD.green}`, borderRadius: 6 }}>
          <div style={{ color: HUD.green, fontWeight: 700, marginBottom: 8 }}>✓ Added: {result.contractor.business_name}</div>
          <div style={{ fontSize: 12, color: HUD.muted, lineHeight: 1.8 }}>
            <div>Location matched: <span style={{ color: HUD.ice }}>{result.geocode.matched}</span></div>
            <div>Business itself found in map data: <span style={{ color: HUD.ice }}>{result.businessFound ? "Yes" : "No — anchored to location only"}</span></div>
            <div>Service area: <span style={{ color: HUD.ice }}>{result.serviceAreaSource}</span></div>
            <div>Pitch fit score: <span style={{ color: HUD.ice }}>{result.contractor.prospect_score}/100</span></div>
            <div style={{ marginTop: 6 }}>Cities: {result.contractor.service_area_cities.join(", ")}</div>
          </div>
          <a href="/twincities/contractor-prospects" style={{ display: "inline-block", marginTop: 14, color: HUD.cyan }}>
            → View in Contractor Prospect Bench
          </a>
        </div>
      )}
    </div>
  );
}
