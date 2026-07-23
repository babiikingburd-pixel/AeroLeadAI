"use client";
import { useState } from "react";
import { buildPropertyProfile } from "../lib/propertyIntelligence";
import { createJobFromLead, opsAvailable } from "../lib/opsStore";
import RoofAnnotationViewer from "./RoofAnnotationViewer";

const AMBER = "#f5a623", PANEL = "#141b26", PANEL2 = "#0f141d", LINE = "#232f3e", MUTE = "#6b7c93", GREEN = "#4caf7d", RED = "#e5534b", BLUE = "#2e7dd1";
const RISK_COLOR = { severe: RED, high: AMBER, moderate: BLUE, low: GREEN };
const TIER_COLOR = { priority: RED, standard: AMBER, "low-priority": MUTE, incomplete: MUTE, excluded: "#8a6bd1" };

// Property Intelligence Engine — pulls together imagery (already on the
// lead), weather, permits, and an AI roof measurement into one profile,
// then computes a free/instant risk score, replacement-cost estimate, and
// qualification tier (lib/propertyIntelligence.js — no AI call for those
// three). Parcel/ownership data isn't included; that needs a county GIS
// API, a vendor decision this doesn't make for you.
export default function PropertyProfilePanel({ lead }) {
  const [weather, setWeather] = useState(null);
  const [permit, setPermit] = useState(null);
  const [measurement, setMeasurement] = useState(null);
  const [annotation, setAnnotation] = useState(null);
  const [busy, setBusy] = useState(false);
  const [jobMsg, setJobMsg] = useState("");

  async function fetchAll() {
    setBusy(true);
    try {
      const tasks = [];
      if (lead.lat && lead.lon) {
        tasks.push(fetch("/api/weather-agent", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ lat: lead.lat, lon: lead.lon }) }).then((r) => r.json()).then(setWeather).catch(() => {}));
      }
      tasks.push(fetch(`/api/permit-lookup?address=${encodeURIComponent(lead.address)}`).then((r) => r.json()).then(setPermit).catch(() => {}));
      if (lead.imagery?.[0]) {
        const m = lead.imagery[0].match(/^data:(image\/[a-zA-Z+]+);base64,(.*)$/);
        if (m) {
          tasks.push(fetch("/api/measure-roof", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ base64Image: m[2], mediaType: m[1], address: lead.address, buildingAge: lead.buildingAge }) }).then((r) => r.json()).then((d) => !d.error && setMeasurement(d)).catch(() => {}));
          tasks.push(fetch("/api/damage-annotate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ base64Image: m[2], mediaType: m[1], address: lead.address }) }).then((r) => r.json()).then((d) => !d.error && setAnnotation(d)).catch(() => {}));
        }
      }
      await Promise.all(tasks);
    } finally {
      setBusy(false);
    }
  }

  async function createJob() {
    setJobMsg("Creating…");
    const job = await createJobFromLead({ ...lead, estValue: profile.cost.estimateUsd });
    if (!job) { setJobMsg("Failed — is Supabase configured? (see supabase_ops_schema.sql)"); return; }
    const url = `${window.location.origin}/portal/${job.share_token}`;
    try { await navigator.clipboard.writeText(url); setJobMsg("Job created — portal link copied to clipboard: " + url); }
    catch { setJobMsg("Job created — portal link: " + url); }
  }

  const profile = buildPropertyProfile(lead, { weather, measurement });

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
        <button onClick={fetchAll} disabled={busy} style={{ padding: "8px 14px", background: busy ? MUTE : AMBER, border: "none", borderRadius: 6, color: "#1a1200", fontWeight: 700, cursor: busy ? "default" : "pointer", fontSize: 13 }}>
          {busy ? "Gathering…" : "↻ Refresh full profile"}
        </button>
        <button onClick={createJob} disabled={!opsAvailable()} title={opsAvailable() ? "" : "Requires Supabase (see supabase_ops_schema.sql)"} style={{ padding: "8px 14px", background: "transparent", border: `1px solid ${LINE}`, borderRadius: 6, color: opsAvailable() ? BLUE : MUTE, cursor: opsAvailable() ? "pointer" : "default", fontSize: 13 }}>
          + Create job &amp; customer portal link
        </button>
      </div>
      {jobMsg && <div style={{ fontSize: 12, color: MUTE, marginBottom: 12, wordBreak: "break-all" }}>{jobMsg}</div>}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 14 }}>
        <div style={{ background: PANEL, border: `1px solid ${LINE}`, borderRadius: 8, padding: 12 }}>
          <div style={{ fontSize: 10, color: MUTE, textTransform: "uppercase" }}>Risk score</div>
          <div style={{ fontSize: 26, fontWeight: 800, color: RISK_COLOR[profile.risk.level] }}>{profile.risk.score}</div>
          <div style={{ fontSize: 11, color: RISK_COLOR[profile.risk.level], textTransform: "uppercase" }}>{profile.risk.level}</div>
        </div>
        <div style={{ background: PANEL, border: `1px solid ${LINE}`, borderRadius: 8, padding: 12 }}>
          <div style={{ fontSize: 10, color: MUTE, textTransform: "uppercase" }}>Replacement cost (rough)</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: GREEN }}>{profile.cost.estimateUsd ? `$${profile.cost.estimateUsd.toLocaleString()}` : "—"}</div>
          {profile.cost.low && <div style={{ fontSize: 11, color: MUTE }}>${profile.cost.low.toLocaleString()}–${profile.cost.high.toLocaleString()}</div>}
        </div>
        <div style={{ background: PANEL, border: `1px solid ${LINE}`, borderRadius: 8, padding: 12 }}>
          <div style={{ fontSize: 10, color: MUTE, textTransform: "uppercase" }}>Qualification</div>
          <div style={{ fontSize: 16, fontWeight: 800, color: TIER_COLOR[profile.qualification.tier], textTransform: "uppercase" }}>{profile.qualification.tier}</div>
          <div style={{ fontSize: 11, color: profile.qualification.qualified ? GREEN : MUTE }}>{profile.qualification.qualified ? "Qualified" : "Not yet"}</div>
        </div>
      </div>

      <div style={{ fontSize: 11, color: MUTE, marginBottom: 14 }}>
        {profile.risk.reasons.length > 0 && <div>Risk factors: {profile.risk.reasons.join("; ")}.</div>}
        {profile.cost.note && <div style={{ marginTop: 4 }}>{profile.cost.note}</div>}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <div style={{ background: PANEL2, border: `1px solid ${LINE}`, borderRadius: 8, padding: 12 }}>
          <div style={{ fontSize: 11, color: AMBER, marginBottom: 6 }}>WEATHER</div>
          {weather ? (
            <div style={{ fontSize: 12, color: "#dfe6ee" }}>
              {weather.summary}
              {weather.freezeThawSignal && <div style={{ color: BLUE, marginTop: 4 }}>❄ Freeze-thaw cycling detected</div>}
              {weather.activeWinterAlerts?.length > 0 && <div style={{ color: RED, marginTop: 4 }}>⚠ {weather.activeWinterAlerts.join(", ")}</div>}
            </div>
          ) : <div style={{ fontSize: 12, color: MUTE }}>Not fetched yet — click "Refresh full profile".</div>}
        </div>
        <div style={{ background: PANEL2, border: `1px solid ${LINE}`, borderRadius: 8, padding: 12 }}>
          <div style={{ fontSize: 11, color: AMBER, marginBottom: 6 }}>PERMITS</div>
          {permit ? (
            <div style={{ fontSize: 12, color: "#dfe6ee" }}>{permit.notes}</div>
          ) : <div style={{ fontSize: 12, color: MUTE }}>Not fetched yet — click "Refresh full profile".</div>}
        </div>
        <div style={{ background: PANEL2, border: `1px solid ${LINE}`, borderRadius: 8, padding: 12 }}>
          <div style={{ fontSize: 11, color: AMBER, marginBottom: 6 }}>ROOF MEASUREMENT (AI estimate)</div>
          {measurement ? (
            <div style={{ fontSize: 12, color: "#dfe6ee" }}>
              ~{measurement.estimated_area_sqft ?? "—"} sqft · {measurement.roof_shape} · {measurement.estimated_facets ?? "?"} facets · {measurement.estimated_pitch} pitch
              <div style={{ color: MUTE, marginTop: 4, fontStyle: "italic" }}>{measurement.caveat}</div>
            </div>
          ) : <div style={{ fontSize: 12, color: MUTE }}>{lead.imagery?.[0] ? 'Not fetched yet — click "Refresh full profile".' : "No imagery on file to measure from."}</div>}
        </div>
        <div style={{ background: PANEL2, border: `1px solid ${LINE}`, borderRadius: 8, padding: 12 }}>
          <div style={{ fontSize: 11, color: AMBER, marginBottom: 6 }}>PARCEL DATA</div>
          <div style={{ fontSize: 12, color: MUTE }}>Requires a county GIS API (varies by jurisdiction) — not wired in. Manual entry available on the deep-dive console.</div>
        </div>
      </div>

      {lead.imagery?.[0] && (
        <div style={{ background: PANEL2, border: `1px solid ${LINE}`, borderRadius: 8, padding: 12, marginTop: 10 }}>
          <div style={{ fontSize: 11, color: AMBER, marginBottom: 8 }}>ANNOTATED DAMAGE (AI bounding boxes)</div>
          {annotation ? (
            <RoofAnnotationViewer imageUrl={lead.imagery[0]} damage={annotation.damage} confidence={annotation.overall_confidence} />
          ) : <div style={{ fontSize: 12, color: MUTE }}>Not fetched yet — click "Refresh full profile".</div>}
        </div>
      )}
    </div>
  );
}
