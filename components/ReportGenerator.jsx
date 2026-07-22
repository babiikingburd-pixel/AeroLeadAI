"use client";
import { useState } from "react";
import { generateReportPdf } from "../lib/reportPdf";
import { upsertLead } from "../lib/leadStore";

const AMBER = "#f5a623", PANEL = "#141b26", LINE = "#232f3e", MUTE = "#6b7c93", GREEN = "#4caf7d";

// AI Inspection & Report Generator: pulls together damage summary,
// confidence, AI-estimated roof measurements, weather history, and imagery
// for one lead, shows a preview, and produces a downloadable PDF.
export default function ReportGenerator({ lead }) {
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState(null);
  const [err, setErr] = useState("");

  async function build() {
    setBusy(true); setErr("");
    try {
      const img = lead.imagery?.[0];
      let measurements = null, weatherSummary = "";

      if (img) {
        const [meta, b64] = img.split(",");
        const mediaType = (meta.match(/data:(.*?);/) || [])[1] || "image/jpeg";
        const mRes = await fetch("/api/measure-roof", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ base64Image: b64, mediaType, address: lead.address }) });
        const mData = await mRes.json();
        if (!mData.error) measurements = mData;
      }
      if (lead.lat && lead.lon) {
        try {
          const wRes = await fetch("/api/weather-agent", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ lat: lead.lat, lon: lead.lon }) });
          const wData = await wRes.json();
          weatherSummary = wData.summary || "";
        } catch {}
      }

      const built = { ...lead, measurements, weatherSummary, scoring: lead.scoring || null };
      setReport(built);
      upsertLead({ address: lead.address, measurements, weatherSummary });
    } catch (e) {
      setErr(e.message || "Report build failed");
    } finally { setBusy(false); }
  }

  return (
    <div style={{ background: PANEL, border: `1px solid ${LINE}`, borderRadius: 10, padding: 16, marginTop: 12 }}>
      <div style={{ fontSize: 12, fontFamily: "monospace", color: AMBER, marginBottom: 10 }}>AI INSPECTION &amp; REPORT GENERATOR</div>

      {!report && (
        <button onClick={build} disabled={busy} style={{ padding: "8px 14px", background: busy ? MUTE : AMBER, border: "none", borderRadius: 6, color: "#1a1200", fontWeight: 700, cursor: busy ? "default" : "pointer", fontSize: 13 }}>
          {busy ? "Building report…" : "Generate inspection report"}
        </button>
      )}
      {err && <div style={{ fontSize: 12, color: "#e5534b", marginTop: 8 }}>{err}</div>}

      {report && (
        <div style={{ fontSize: 13, color: "#dfe6ee" }}>
          <div style={{ marginBottom: 8 }}><b>Damage summary:</b> {report.findingsScore != null ? `${report.findingsScore}% damage probability` : "not yet scored"} ({report.confidence || "confidence unreported"})</div>
          {report.measurements && (
            <div style={{ marginBottom: 8 }}>
              <b>AI-estimated measurements</b> (rough visual estimate, not a takeoff): {report.measurements.estimated_area_sqft ? `${report.measurements.estimated_area_sqft} sq ft` : "—"}, {report.measurements.roof_shape}, {report.measurements.estimated_facets} facets, {report.measurements.estimated_pitch} pitch.
              <div style={{ fontSize: 11, color: MUTE, marginTop: 2 }}>{report.measurements.caveat}</div>
            </div>
          )}
          {report.weatherSummary && <div style={{ marginBottom: 8 }}><b>Weather history:</b> {report.weatherSummary}</div>}
          <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
            <button onClick={() => generateReportPdf(report)} style={{ padding: "8px 14px", background: GREEN, border: "none", borderRadius: 6, color: "#0d1420", fontWeight: 700, cursor: "pointer", fontSize: 13 }}>⬇ Download PDF</button>
            <button onClick={() => setReport(null)} style={{ padding: "8px 14px", background: "transparent", border: `1px solid ${LINE}`, borderRadius: 6, color: MUTE, cursor: "pointer", fontSize: 13 }}>Rebuild</button>
          </div>
        </div>
      )}
    </div>
  );
}
