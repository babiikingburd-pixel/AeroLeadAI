"use client";
import { useState } from "react";
import SystemHealthMonitor from "./SystemHealthMonitor";
import ImageReviewQueue from "./ImageReviewQueue";

const SLATE = "#0d1420", PANEL = "#131c2b", LINE = "#22304a", TEXT = "#dfe6ee", MUTE = "#77839a";
const AMBER = "#f5b942", BLUE = "#4fa3e3", GREEN = "#4fc98e", RED = "#ef5a6f";

function nowStamp() {
  return new Date().toLocaleTimeString();
}

export default function MaintenanceConsole() {
  const [log, setLog] = useState([]);

  const [zip, setZip] = useState("");
  const [batchSize, setBatchSize] = useState(4);
  const [scanBusy, setScanBusy] = useState(false);
  const [scanResult, setScanResult] = useState(null);

  const [stormLat, setStormLat] = useState("");
  const [stormLng, setStormLng] = useState("");
  const [stormRadius, setStormRadius] = useState(10);
  const [stormEvent, setStormEvent] = useState("");
  const [stormBusy, setStormBusy] = useState(false);
  const [stormResult, setStormResult] = useState(null);

  const [eiCounty, setEiCounty] = useState("");
  const [eiLimit, setEiLimit] = useState(25);
  const [eiBusy, setEiBusy] = useState(false);
  const [eiResult, setEiResult] = useState(null);

  function pushLog(entry) {
    setLog((l) => [{ id: Math.random().toString(36).slice(2), at: nowStamp(), entry }, ...l].slice(0, 30));
  }

  async function runContinuousScan() {
    if (!zip.trim()) return;
    setScanBusy(true);
    setScanResult(null);
    pushLog(`Real-property scan started — ZIP ${zip}, batch ${batchSize}`);
    try {
      const res = await fetch("/api/scan/continuous", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ zipCode: zip.trim(), batchSize }),
      });
      const data = await res.json();
      setScanResult(data);
      pushLog(data.success ? `Real-property scan complete — ${data.leads?.length ?? 0} eligible lead(s) ranked` : `Property scan failed: ${data.error}`);
    } catch (e) {
      setScanResult({ success: false, error: e.message });
      pushLog(`Continuous scan errored: ${e.message}`);
    } finally {
      setScanBusy(false);
    }
  }

  async function runStormScan() {
    if (!stormLat || !stormLng) return;
    setStormBusy(true);
    setStormResult(null);
    pushLog(`Storm scan started — (${stormLat}, ${stormLng}) radius ${stormRadius}mi`);
    try {
      const res = await fetch("/api/scan/storm", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ lat: parseFloat(stormLat), lng: parseFloat(stormLng), radius: parseFloat(stormRadius), eventType: stormEvent }),
      });
      const data = await res.json();
      setStormResult(data);
      pushLog(data.triggered ? `Storm scan triggered — ${data.affectedZips?.length ?? 0} zip(s), ${data.leadsQueued ?? 0} lead(s) queued` : `Storm scan: ${data.note || data.error || "not triggered"}`);
    } catch (e) {
      setStormResult({ triggered: false, error: e.message });
      pushLog(`Storm scan errored: ${e.message}`);
    } finally {
      setStormBusy(false);
    }
  }

  async function runEvidenceIndex() {
    setEiBusy(true);
    setEiResult(null);
    pushLog(`Evidence Index started — ${eiCounty.trim() || "all six counties"}, limit ${eiLimit}`);
    try {
      const params = new URLSearchParams({ limit: String(eiLimit) });
      if (eiCounty.trim()) params.set("county", eiCounty.trim().toLowerCase());
      const res = await fetch(`/api/evidence-index?${params.toString()}`, { method: "POST" });
      const data = await res.json();
      setEiResult(data);
      pushLog(data.ok ? `Evidence Index complete — ${data.scanned ?? 0} scanned, ${data.reviewCount ?? 0} flagged for review` : `Evidence Index failed: ${data.error}`);
    } catch (e) {
      setEiResult({ ok: false, error: e.message });
      pushLog(`Evidence Index errored: ${e.message}`);
    } finally {
      setEiBusy(false);
    }
  }

  const inputStyle = { background: SLATE, border: `1px solid ${LINE}`, borderRadius: 6, color: TEXT, padding: "8px 10px", fontSize: 13 };
  const btnStyle = (color) => ({ padding: "8px 14px", background: "transparent", border: `1px solid ${color}`, borderRadius: 6, color, cursor: "pointer", fontSize: 13 });

  return (
    <div style={{ minHeight: "100vh", background: SLATE, color: TEXT, fontFamily: "Inter, system-ui, sans-serif", padding: "24px 28px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", borderBottom: `1px solid ${LINE}`, paddingBottom: 14, marginBottom: 18 }}>
        <div>
          <div style={{ fontSize: 11, letterSpacing: 2, color: AMBER, fontFamily: "monospace" }}>AEROLEADAI</div>
          <h1 style={{ fontSize: 22, margin: "4px 0 0" }}>🔧 Maintenance Console</h1>
          <p style={{ color: MUTE, fontSize: 12, margin: "4px 0 0" }}>System health, manual scan triggers, and activity log.</p>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
        <SystemHealthMonitor />

        <div style={{ background: PANEL, border: `1px solid ${LINE}`, borderRadius: 10, padding: 16, maxHeight: 280, overflowY: "auto" }}>
          <div style={{ fontSize: 11, color: AMBER, fontFamily: "monospace", marginBottom: 10 }}>ACTIVITY LOG</div>
          {log.length === 0 && <div style={{ fontSize: 12, color: MUTE }}>No actions taken yet this session.</div>}
          {log.map((l) => (
            <div key={l.id} style={{ fontSize: 12, padding: "5px 0", borderTop: `1px solid ${LINE}` }}>
              <span style={{ color: MUTE }}>{l.at}</span> — {l.entry}
            </div>
          ))}
        </div>
      </div>

      <div style={{ marginBottom: 16 }}>
        <ImageReviewQueue />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <div style={{ background: PANEL, border: `1px solid ${LINE}`, borderRadius: 10, padding: 16 }}>
          <div style={{ fontSize: 11, color: AMBER, fontFamily: "monospace", marginBottom: 10 }}>REAL PROPERTY SCAN</div>
          <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
            <input style={{ ...inputStyle, flex: 1, minWidth: 100 }} placeholder="ZIP code" value={zip} onChange={(e) => setZip(e.target.value)} />
            <input style={{ ...inputStyle, width: 90 }} type="number" min={1} max={10} value={batchSize} onChange={(e) => setBatchSize(e.target.value)} />
            <button onClick={runContinuousScan} disabled={scanBusy} style={btnStyle(BLUE)}>{scanBusy ? "Scanning…" : "Run scan"}</button>
          </div>
          {scanResult && (
            <div style={{ fontSize: 12, color: scanResult.success ? GREEN : RED }}>
              {scanResult.success ? `${scanResult.leads?.length ?? 0} eligible lead(s) ranked at ${scanResult.scannedAt}${scanResult.note ? ` — ${scanResult.note}` : ""}` : scanResult.error}
            </div>
          )}
        </div>

        <div style={{ background: PANEL, border: `1px solid ${LINE}`, borderRadius: 10, padding: 16 }}>
          <div style={{ fontSize: 11, color: AMBER, fontFamily: "monospace", marginBottom: 10 }}>STORM SCAN</div>
          <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
            <input style={{ ...inputStyle, width: 100 }} placeholder="lat" value={stormLat} onChange={(e) => setStormLat(e.target.value)} />
            <input style={{ ...inputStyle, width: 100 }} placeholder="lng" value={stormLng} onChange={(e) => setStormLng(e.target.value)} />
            <input style={{ ...inputStyle, width: 80 }} type="number" placeholder="radius mi" value={stormRadius} onChange={(e) => setStormRadius(e.target.value)} />
            <input style={{ ...inputStyle, width: 120 }} placeholder="event type (e.g. hail)" value={stormEvent} onChange={(e) => setStormEvent(e.target.value)} />
            <button onClick={runStormScan} disabled={stormBusy} style={btnStyle(BLUE)}>{stormBusy ? "Checking…" : "Check & scan"}</button>
          </div>
          {stormResult && (
            <div style={{ fontSize: 12, color: stormResult.triggered ? GREEN : MUTE }}>
              {stormResult.triggered
                ? `Triggered — ${stormResult.affectedZips?.join(", ")} — ${stormResult.leadsQueued} lead(s) queued`
                : stormResult.note || stormResult.error || "No alert matched."}
            </div>
          )}
        </div>

        <div style={{ background: PANEL, border: `1px solid ${LINE}`, borderRadius: 10, padding: 16 }}>
          <div style={{ fontSize: 11, color: AMBER, fontFamily: "monospace", marginBottom: 10 }}>EVIDENCE INDEX</div>
          <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
            <input style={{ ...inputStyle, flex: 1, minWidth: 120 }} placeholder="County (blank = all six)" value={eiCounty} onChange={(e) => setEiCounty(e.target.value)} />
            <input style={{ ...inputStyle, width: 90 }} type="number" min={1} max={100} value={eiLimit} onChange={(e) => setEiLimit(e.target.value)} />
            <button onClick={runEvidenceIndex} disabled={eiBusy} style={btnStyle(BLUE)}>{eiBusy ? "Scoring…" : "Run pipeline"}</button>
          </div>
          {eiResult && (
            <div style={{ fontSize: 12, color: eiResult.ok ? GREEN : RED }}>
              {eiResult.ok
                ? `Scanned ${eiResult.scanned} · ${eiResult.reviewCount} flagged for review${eiResult.note ? ` — ${eiResult.note}` : ""}`
                : eiResult.error}
              {eiResult.ok && eiResult.results?.length > 0 && (
                <div style={{ marginTop: 8, maxHeight: 160, overflowY: "auto" }}>
                  {eiResult.results.slice(0, 20).map((r) => (
                    <div key={r.id} style={{ padding: "4px 0", borderTop: `1px solid ${LINE}`, color: r.reviewRequired ? AMBER : MUTE }}>
                      {r.address} — evidence {r.evidenceScore} · confidence {r.confidenceScore} · opp ${r.opportunityRawDollars?.toLocaleString()} ({r.opportunityNormalized}) {r.reviewRequired ? "· REVIEW" : ""}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
