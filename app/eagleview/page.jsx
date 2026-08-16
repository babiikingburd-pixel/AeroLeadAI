"use client";

import { useState } from "react";

export default function EagleViewLab() {
  const [address, setAddress] = useState("");
  const [status, setStatus] = useState(null);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);

  async function check() {
    setLoading(true);
    try {
      const res = await fetch("/api/eagleview", { cache: "no-store" });
      setStatus(await res.json());
    } finally { setLoading(false); }
  }

  async function run(e) {
    e.preventDefault();
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch("/api/eagleview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address, wait: true }),
      });
      setResult(await res.json());
    } catch (err) {
      setResult({ ok: false, error: err.message });
    } finally { setLoading(false); }
  }

  return (
    <main style={{ minHeight: "100vh", background: "#07111f", color: "#e7f4ff", padding: 28, fontFamily: "system-ui" }}>
      <div style={{ maxWidth: 1180, margin: "0 auto" }}>
        <p style={{ color: "#55d7ff", letterSpacing: 3, fontWeight: 800 }}>AEROLEADAI // EAGLEVIEW LAB</p>
        <h1 style={{ fontSize: 38, margin: "8px 0" }}>30-Day Intelligence Evaluation Console</h1>
        <p style={{ color: "#9db0c6", maxWidth: 850 }}>
          Pull entitled EagleView property intelligence and imagery, then benchmark it against AeroLeadAI's existing evidence stack. Credentials remain server-side.
        </p>

        <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 12, margin: "24px 0" }}>
          {["Roof area + pitch", "Material + condition", "Roof age", "Risk scores", "Building outlines", "Ortho imagery", "Oblique imagery", "AI evidence fusion"].map((x) =>
            <div key={x} style={{ border: "1px solid #1c3855", background: "#0b1b2d", borderRadius: 12, padding: 16 }}>{x}</div>
          )}
        </section>

        <button onClick={check} disabled={loading} style={{ padding: "12px 18px", borderRadius: 9, border: 0, fontWeight: 800, cursor: "pointer" }}>
          Check EagleView Connection
        </button>
        {status && <pre style={{ whiteSpace: "pre-wrap", background: "#091522", padding: 16, borderRadius: 10 }}>{JSON.stringify(status, null, 2)}</pre>}

        <form onSubmit={run} style={{ marginTop: 28, display: "flex", gap: 10, flexWrap: "wrap" }}>
          <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Property address (sandbox must use EagleView sandbox coverage)" required
            style={{ flex: "1 1 500px", padding: 14, borderRadius: 9, border: "1px solid #31506e", background: "#0a1725", color: "white" }} />
          <button disabled={loading} style={{ padding: "12px 22px", borderRadius: 9, border: 0, fontWeight: 900, cursor: "pointer" }}>
            {loading ? "Working..." : "Run EagleView Analysis"}
          </button>
        </form>

        {result && (
          <section style={{ marginTop: 24 }}>
            <h2>Result</h2>
            {result.images?.length > 0 && (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))", gap: 14 }}>
                {result.images.map((img, i) => (
                  <figure key={img.token || i} style={{ margin: 0, background: "#0b1b2d", borderRadius: 12, overflow: "hidden" }}>
                    <img src={img.proxyUrl} alt={`EagleView property image ${i + 1}`} style={{ width: "100%", display: "block" }} />
                    <figcaption style={{ padding: 10, color: "#9db0c6" }}>{img.sourcePath || `Image ${i + 1}`}</figcaption>
                  </figure>
                ))}
              </div>
            )}
            <details style={{ marginTop: 18 }} open={!result.ok}>
              <summary>Raw EagleView response</summary>
              <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", background: "#091522", padding: 16, borderRadius: 10 }}>{JSON.stringify(result, null, 2)}</pre>
            </details>
          </section>
        )}
      </div>
    </main>
  );
}
