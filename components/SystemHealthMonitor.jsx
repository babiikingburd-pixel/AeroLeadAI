"use client";
import { useEffect, useRef, useState } from "react";
import { HUD } from "../lib/hudTheme";

const POLL_MS = 20 * 60 * 1000; // 20 min — inside the requested 15-30 min window

const STATUS_COLOR = { go: HUD.green, degraded: HUD.amber, down: HUD.red };
const STATUS_LABEL = { go: "GO", degraded: "DEGRADED", down: "DOWN" };

function Row({ name, check }) {
  if (!check) return null;
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 12, padding: "7px 0", borderTop: `1px solid ${HUD.lineDim}` }}>
      <span style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
        <span style={{ width: 7, height: 7, borderRadius: "50%", background: STATUS_COLOR[check.status] || HUD.muted }} />
        {name}
      </span>
      <span style={{ color: HUD.muted, textAlign: "right" }}>{check.detail}</span>
    </div>
  );
}

// Self-polling health monitor, mounted on both the Executive tab and the
// Maintenance Console. Every check run calls /api/system-health/checkpoint,
// which itself records a Supabase checkpoint and attempts bounded recovery —
// this component is just the display + polling loop around that.
export default function SystemHealthMonitor() {
  const [result, setResult] = useState(null);
  const [checking, setChecking] = useState(false);
  const intervalRef = useRef(null);

  async function runCheck() {
    setChecking(true);
    try {
      const res = await fetch("/api/system-health/checkpoint");
      const data = await res.json();
      setResult(data);
    } catch (e) {
      setResult({ ok: false, overall: "down", error: e.message });
    } finally {
      setChecking(false);
    }
  }

  useEffect(() => {
    runCheck(); // on mount — covers "re-check after every deployment" for anyone loading the page post-deploy
    intervalRef.current = setInterval(runCheck, POLL_MS);
    return () => clearInterval(intervalRef.current);
  }, []);

  const overall = result?.overall;

  return (
    <div style={{ background: "#131c2b", border: `1px solid ${HUD.lineDim}`, borderRadius: 10, padding: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <div style={{ fontSize: 11, color: HUD.amber, fontFamily: HUD.fontMono, letterSpacing: "0.05em" }}>SYSTEM HEALTH</div>
        <button onClick={runCheck} disabled={checking} style={{ background: "none", border: `1px solid ${HUD.lineDim}`, borderRadius: 6, color: HUD.cyan, fontSize: 11, padding: "4px 10px", cursor: "pointer" }}>
          {checking ? "Checking…" : "↻ Recheck now"}
        </button>
      </div>

      {overall && (
        <div
          style={{
            display: "inline-block", padding: "4px 12px", borderRadius: 4, marginBottom: 10,
            fontFamily: HUD.fontDisplay, fontWeight: 700, fontSize: 13, letterSpacing: "0.08em",
            color: STATUS_COLOR[overall], border: `1px solid ${STATUS_COLOR[overall]}`,
            boxShadow: `0 0 10px ${STATUS_COLOR[overall]}33`,
          }}
        >
          {STATUS_LABEL[overall] || "UNKNOWN"}
        </div>
      )}

      {!result && <div style={{ fontSize: 12, color: HUD.muted }}>Running first check…</div>}
      {result?.error && <div style={{ fontSize: 12, color: HUD.red }}>{result.error}</div>}

      <Row name="Map (Mapbox)" check={result?.map} />
      <Row name="Imagery pipeline" check={result?.imagery} />
      <Row name="Crawlers" check={result?.crawlers} />

      {result?.recovery && (
        <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${HUD.lineDim}`, fontSize: 11, color: HUD.amber }}>
          Auto-recovery attempted: {result.recovery.attempts.map((a) => `${a.target} ${a.before}→${a.after}`).join(", ") || "no retriable pieces"}
          {result.recovery.baseline && <div style={{ color: HUD.muted, marginTop: 4 }}>Last known-good checkpoint available for comparison.</div>}
        </div>
      )}

      {result?.checkpoint && !result.checkpoint.ok && (
        <div style={{ marginTop: 10, fontSize: 11, color: HUD.muted }}>Checkpoint not recorded: {result.checkpoint.error}</div>
      )}
    </div>
  );
}
