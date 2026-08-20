"use client";

import { useState } from "react";

const PANEL = "#141b26";
const PANEL2 = "#1a2330";
const LINE = "#232f3e";
const AMBER = "#f5a623";
const MUTED = "#6b7c93";
const SIGNAL = "#ff5a3c";

export default function AccessPage() {
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/auth/access", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "Access denied.");
      const requested = new URLSearchParams(window.location.search).get("next") || "/";
      window.location.assign(requested.startsWith("/") && !requested.startsWith("//") ? requested : "/");
    } catch (failure) {
      setError(failure.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main style={{ minHeight: "80vh", display: "grid", placeItems: "center", padding: 24 }}>
      <form onSubmit={submit} style={{ background: PANEL, padding: 36, borderRadius: 16, width: "min(360px, 100%)", border: `1px solid ${LINE}`, boxSizing: "border-box" }}>
        <div style={{ fontSize: 11, letterSpacing: 2, color: AMBER, fontFamily: "monospace", textAlign: "center" }}>AEROLEADAI SECURE</div>
        <h1 style={{ color: "#dfe6ee", fontSize: 22, margin: "8px 0 4px", textAlign: "center" }}>Owner Access</h1>
        <p style={{ color: MUTED, fontSize: 13, textAlign: "center", marginBottom: 20 }}>The database and internal APIs are private.</p>
        <label htmlFor="access-code" style={{ color: "#aeb9c8", fontSize: 12 }}>Access code</label>
        <input id="access-code" type="password" autoComplete="current-password" value={code} onChange={(event) => setCode(event.target.value)} style={{ width: "100%", padding: 12, margin: "8px 0 12px", background: PANEL2, border: `1px solid ${LINE}`, color: "#dfe6ee", borderRadius: 8, boxSizing: "border-box" }} />
        <button type="submit" disabled={loading || !code} style={{ width: "100%", padding: 12, background: AMBER, color: "#1a1200", border: 0, borderRadius: 8, fontWeight: 700, cursor: "pointer", opacity: loading || !code ? 0.6 : 1 }}>{loading ? "Checking…" : "Enter AeroLeadAI"}</button>
        {error && <p role="alert" style={{ color: SIGNAL, fontSize: 12, marginTop: 12 }}>{error}</p>}
      </form>
    </main>
  );
}
