"use client";
import { useEffect, useRef, useState } from "react";
import { listJobs, listContractors, opsAvailable, JOB_STATUSES } from "../lib/opsStore";
import { loadLeads, importConsoleProperties } from "../lib/leadStore";

const SLATE = "#0d1420", PANEL = "#131c2b", PANEL2 = "#0f1725", LINE = "#22304a", TEXT = "#dfe6ee", MUTE = "#77839a";
const AMBER = "#f5b942", BLUE = "#4fa3e3", GREEN = "#4fc98e", RED = "#ef5a6f";
const STATUS_COLOR = { new: MUTE, scheduled: BLUE, in_progress: AMBER, completed: GREEN, canceled: RED };

// Autonomous Operations Command Center: a single screen for revenue, active
// jobs, contractor locations, system health, weather alerts, AI confidence,
// and an exception queue — designed for minimal human oversight, but
// everything here is a REAL signal from data already in the app, not a
// simulated metric. Two honest limitations, labeled everywhere they show up:
//   - "Contractor locations" are manually set/last-check-in, not live GPS
//     (that needs a mobile app or phone location source — a product
//     decision, not something to fake).
//   - "AI voice activity" isn't included — no voice/telephony vendor is
//     configured (Twilio/Vapi/etc. is a business decision).
export default function OpsCommandCenter() {
  const [jobs, setJobs] = useState([]);
  const [contractors, setContractors] = useState([]);
  const [leads, setLeads] = useState([]);
  const [health, setHealth] = useState(null);
  const [weatherAlerts, setWeatherAlerts] = useState(null);
  const [checkingWeather, setCheckingWeather] = useState(false);
  const mapRef = useRef(null);
  const mapInstance = useRef(null);
  const [mapReady, setMapReady] = useState(false);

  async function refresh() {
    setJobs(await listJobs());
    setContractors(await listContractors());
    setLeads(importConsoleProperties());
  }

  useEffect(() => {
    refresh();
    fetch("/api/system-health").then((r) => r.json()).then(setHealth).catch(() => {});
  }, []);

  async function checkWeatherAlerts() {
    setCheckingWeather(true);
    try {
      const withCoords = jobs.filter((j) => j.lat && j.lon && ["new", "scheduled", "in_progress"].includes(j.status)).slice(0, 15);
      const results = await Promise.all(withCoords.map((j) =>
        fetch("/api/weather-agent", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ lat: j.lat, lon: j.lon }) })
          .then((r) => r.json()).then((d) => ({ address: j.address, alerts: d.activeWinterAlerts || [] })).catch(() => ({ address: j.address, alerts: [] }))
      ));
      setWeatherAlerts(results.filter((r) => r.alerts.length > 0));
    } finally {
      setCheckingWeather(false);
    }
  }

  // ---- map: jobs + contractors, no clustering needed at this scale ----
  useEffect(() => {
    const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
    if (!token) return;
    if (window.mapboxgl) { setMapReady(true); return; }
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "https://api.mapbox.com/mapbox-gl-js/v3.4.0/mapbox-gl.css";
    document.head.appendChild(link);
    const script = document.createElement("script");
    script.src = "https://api.mapbox.com/mapbox-gl-js/v3.4.0/mapbox-gl.js";
    script.onload = () => setMapReady(true);
    document.head.appendChild(script);
  }, []);

  useEffect(() => {
    const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
    if (!mapReady || !mapRef.current || mapInstance.current || !token || !token.startsWith("pk.")) return;
    try {
      window.mapboxgl.accessToken = token;
      mapInstance.current = new window.mapboxgl.Map({ container: mapRef.current, style: "mapbox://styles/mapbox/dark-v11", center: [-93.26, 44.98], zoom: 4 });
      mapInstance.current.addControl(new window.mapboxgl.NavigationControl(), "top-right");
    } catch (e) { console.error("[OpsCommandCenter] Mapbox init failed:", e.message); }
  }, [mapReady]);

  useEffect(() => {
    const map = mapInstance.current;
    if (!map) return;
    const markers = [];
    jobs.filter((j) => j.lat && j.lon).forEach((j) => {
      const el = document.createElement("div");
      el.style.cssText = `width:14px;height:14px;border-radius:50%;background:${STATUS_COLOR[j.status] || MUTE};border:2px solid rgba(255,255,255,.7)`;
      el.title = `${j.address} — ${j.status}`;
      const m = new window.mapboxgl.Marker(el).setLngLat([j.lon, j.lat]).addTo(map);
      markers.push(m);
    });
    contractors.filter((c) => c.last_lat && c.last_lon).forEach((c) => {
      const el = document.createElement("div");
      el.style.cssText = `width:16px;height:16px;border-radius:3px;background:${BLUE};border:2px solid #fff;display:flex;align-items:center;justify-content:center;font-size:9px;color:#fff`;
      el.textContent = "C";
      el.title = `${c.name} (last known location)`;
      const m = new window.mapboxgl.Marker(el).setLngLat([c.last_lon, c.last_lat]).addTo(map);
      markers.push(m);
    });
    return () => markers.forEach((m) => m.remove());
  }, [jobs, contractors, mapReady]);

  const revenueActual = jobs.filter((j) => j.status === "completed").reduce((s, j) => s + (j.revenue_actual || j.revenue_estimate || 0), 0);
  const revenuePipeline = jobs.filter((j) => j.status !== "completed" && j.status !== "canceled").reduce((s, j) => s + (j.revenue_estimate || 0), 0);
  const activeJobs = jobs.filter((j) => ["scheduled", "in_progress"].includes(j.status)).length;
  const unassigned = jobs.filter((j) => !j.contractor_id && j.status !== "completed" && j.status !== "canceled").length;

  const confidences = leads.map((l) => l.confidence).filter(Boolean);
  const confPct = { low: 45, medium: 70, high: 90 };
  const avgConfidence = confidences.length ? Math.round(confidences.reduce((s, c) => s + (confPct[c] || 60), 0) / confidences.length) : null;

  // Exception queue: things that actually need a human look, computed from
  // real data — not a simulated alert feed.
  const exceptions = [
    ...jobs.filter((j) => !j.contractor_id && ["scheduled", "in_progress"].includes(j.status)).map((j) => ({ type: "Unassigned active job", detail: j.address, severity: "high" })),
    ...leads.filter((l) => l.confidence === "low" && (l.findingsScore ?? 0) >= 50).map((l) => ({ type: "High score, low AI confidence — verify manually", detail: l.address, severity: "medium" })),
    ...jobs.filter((j) => j.status === "scheduled" && j.scheduled_date && new Date(j.scheduled_date) < new Date()).map((j) => ({ type: "Scheduled date passed, not marked complete", detail: j.address, severity: "medium" })),
  ];

  return (
    <div style={{ minHeight: "100vh", background: SLATE, color: TEXT, fontFamily: "Inter, system-ui, sans-serif", padding: "24px 28px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", borderBottom: `1px solid ${LINE}`, paddingBottom: 14, marginBottom: 18 }}>
        <div>
          <div style={{ fontSize: 11, letterSpacing: 2, color: AMBER, fontFamily: "monospace" }}>AEROLEADAI</div>
          <h1 style={{ fontSize: 22, margin: "4px 0 0" }}>Autonomous Operations Command Center</h1>
          <p style={{ color: MUTE, fontSize: 12, margin: "4px 0 0" }}>Contractor locations are manually set / last check-in, not live GPS. AI voice activity isn't included (no telephony vendor configured).</p>
        </div>
        <button onClick={refresh} style={{ padding: "8px 14px", background: "transparent", border: `1px solid ${LINE}`, borderRadius: 6, color: GREEN, cursor: "pointer", fontSize: 13 }}>↻ Refresh</button>
      </div>

      {!opsAvailable() && (
        <div style={{ background: PANEL, border: `1px solid ${AMBER}`, borderRadius: 8, padding: 14, marginBottom: 18, fontSize: 13, color: AMBER }}>
          Jobs and contractors require Supabase — run <code>supabase_ops_schema.sql</code> and set NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY.
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10, marginBottom: 18 }}>
        {[
          ["Active jobs", activeJobs, BLUE],
          ["Unassigned", unassigned, unassigned > 0 ? RED : GREEN],
          ["Revenue (completed)", `$${revenueActual.toLocaleString()}`, GREEN],
          ["Pipeline (est.)", `$${revenuePipeline.toLocaleString()}`, AMBER],
          ["Avg AI confidence", avgConfidence != null ? `${avgConfidence}%` : "—", TEXT],
          ["Contractors", contractors.filter((c) => c.active).length, TEXT],
        ].map(([label, value, color]) => (
          <div key={label} style={{ background: PANEL, border: `1px solid ${LINE}`, borderRadius: 8, padding: "12px 14px" }}>
            <div style={{ fontFamily: "monospace", fontSize: 20, fontWeight: 700, color }}>{value}</div>
            <div style={{ fontSize: 10.5, color: MUTE, textTransform: "uppercase", letterSpacing: ".06em", marginTop: 2 }}>{label}</div>
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 16, marginBottom: 18 }}>
        <div style={{ position: "relative", height: 380, borderRadius: 10, overflow: "hidden", border: `1px solid ${LINE}` }}>
          <div ref={mapRef} style={{ width: "100%", height: "100%" }} />
          {!process.env.NEXT_PUBLIC_MAPBOX_TOKEN && (
            <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: PANEL2, color: MUTE, fontSize: 13 }}>Map needs NEXT_PUBLIC_MAPBOX_TOKEN</div>
          )}
        </div>

        <div style={{ background: PANEL, border: `1px solid ${LINE}`, borderRadius: 10, padding: 14, overflowY: "auto", maxHeight: 380 }}>
          <div style={{ fontSize: 11, color: AMBER, marginBottom: 10, fontFamily: "monospace" }}>SYSTEM HEALTH</div>
          {!health && <div style={{ fontSize: 12, color: MUTE }}>Checking…</div>}
          {health?.checks.map((c) => (
            <div key={c.name} style={{ display: "flex", justifyContent: "space-between", gap: 8, padding: "6px 0", borderTop: `1px solid ${LINE}`, fontSize: 12 }}>
              <span>{c.ok ? "✅" : "⚠️"} {c.name}</span>
              <span style={{ color: MUTE, textAlign: "right" }}>{c.detail}</span>
            </div>
          ))}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <div style={{ background: PANEL, border: `1px solid ${LINE}`, borderRadius: 10, padding: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <div style={{ fontSize: 11, color: AMBER, fontFamily: "monospace" }}>WEATHER ALERTS — ACTIVE JOBS</div>
            <button onClick={checkWeatherAlerts} disabled={checkingWeather} style={{ padding: "5px 10px", background: "transparent", border: `1px solid ${LINE}`, borderRadius: 6, color: BLUE, fontSize: 11, cursor: "pointer" }}>{checkingWeather ? "Checking…" : "Check now"}</button>
          </div>
          {weatherAlerts === null && <div style={{ fontSize: 12, color: MUTE }}>Click "Check now" — queries live NWS alerts for active job locations (capped at 15 per check).</div>}
          {weatherAlerts?.length === 0 && <div style={{ fontSize: 12, color: GREEN }}>No active winter alerts for scanned jobs.</div>}
          {weatherAlerts?.map((w, i) => (
            <div key={i} style={{ fontSize: 12, padding: "6px 0", borderTop: `1px solid ${LINE}` }}>
              <b>{w.address}</b>: <span style={{ color: RED }}>{w.alerts.join(", ")}</span>
            </div>
          ))}
        </div>

        <div style={{ background: PANEL, border: `1px solid ${LINE}`, borderRadius: 10, padding: 14 }}>
          <div style={{ fontSize: 11, color: AMBER, marginBottom: 10, fontFamily: "monospace" }}>EXCEPTION QUEUE ({exceptions.length})</div>
          {exceptions.length === 0 && <div style={{ fontSize: 12, color: GREEN }}>Nothing needs attention right now.</div>}
          {exceptions.map((e, i) => (
            <div key={i} style={{ fontSize: 12, padding: "6px 0", borderTop: `1px solid ${LINE}`, color: e.severity === "high" ? RED : AMBER }}>
              {e.type}: <span style={{ color: TEXT }}>{e.detail}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
