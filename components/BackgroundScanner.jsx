"use client";
import { useEffect, useState } from "react";
import { upsertLead } from "../lib/leadStore";
import { enqueueJob, runQueue, subscribe, requestNotifyPermission } from "../lib/jobQueue";

const AMBER = "#f5a623", PANEL = "#141b26", LINE = "#232f3e", MUTE = "#6b7c93", GREEN = "#4caf7d", BLUE = "#2e7dd1";
const SCAN_CACHE_KEY = "aeroleadai_scan_cache_v1";

function loadCache() { try { return JSON.parse(localStorage.getItem(SCAN_CACHE_KEY) || "{}"); } catch { return {}; } }
function saveCache(c) { try { localStorage.setItem(SCAN_CACHE_KEY, JSON.stringify(c)); } catch {} }

// Background AI Lead Scanner: point it at a ZIP, it discovers real
// addresses and queues them through the shared Background Processing Engine
// (lib/jobQueue.js) — geocode -> imagery -> roof scoring, with automatic
// retries, pause/resume, and resume-on-reload handled by the engine, not by
// this component. Completed scans are cached so repeat requests are instant.
async function scanAddressJob(item) {
  const cache = loadCache();
  const key = item.address.toLowerCase();
  if (cache[key]) return cache[key];

  let lat = item.lat, lon = item.lon;
  if (!lat || !lon) {
    const g = await (await fetch("/api/geocode", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ address: item.address }) })).json();
    if (!g.ok) throw new Error("geocode failed");
    lat = g.lat; lon = g.lon;
  }
  const img = await (await fetch("/api/imagery-agent", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ lat: +lat, lon: +lon, lite: true }) })).json();
  const dataUrl = img.dataUrl || img.angles?.overview_tight;
  if (!dataUrl) throw new Error("imagery failed");
  const [meta, b64] = dataUrl.split(",");
  const mediaType = (meta.match(/data:(.*?);/) || [])[1] || "image/jpeg";
  const scan = await (await fetch("/api/damage-agent", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ domain: "roof", base64Image: b64, mediaType, address: item.address }) })).json();
  if (scan.error) throw new Error(scan.error);

  const lead = { address: item.address, lat, lon, findingsScore: scan.concern_score, confidence: scan.confidence, indicators: scan.indicators || [], notes: scan.notes || "", imagery: [dataUrl], scannedAt: new Date().toISOString(), source: "background-scanner" };
  cache[key] = lead; saveCache(cache);
  upsertLead(lead);
  return lead;
}

const HANDLERS = { "scan-address": scanAddressJob };

export default function BackgroundScanner() {
  const [zip, setZip] = useState("");
  const [msg, setMsg] = useState("");
  const [jobs, setJobs] = useState([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    requestNotifyPermission();
    runQueue(HANDLERS); // resume any interrupted jobs from a previous session
    const unsub = subscribe((state) => setJobs(state.jobs.filter((j) => j.type === "scan-address")));
    return unsub;
  }, []);

  async function discoverAndQueue() {
    if (!/^\d{5}$/.test(zip.trim())) { setMsg("Enter a valid 5-digit ZIP."); return; }
    setBusy(true); setMsg(`Discovering addresses in ${zip}…`);
    try {
      const res = await fetch(`/api/zip-scan?zip=${zip}&max=40`);
      const d = await res.json();
      if (!d.ok) { setMsg("⚠ " + (d.error || "ZIP scan failed")); setBusy(false); return; }
      const cache = loadCache();
      const fresh = d.addresses.filter((a) => !cache[a.address.toLowerCase()]);
      const cachedCount = d.addresses.length - fresh.length;
      enqueueJob({ type: "scan-address", label: `ZIP ${zip} (${d.city || ""}, ${d.state || ""})`, items: fresh.length ? fresh : d.addresses });
      runQueue(HANDLERS);
      setMsg(`Queued ${fresh.length} new propert${fresh.length === 1 ? "y" : "ies"}${cachedCount ? ` (${cachedCount} already cached)` : ""} — running now.`);
    } catch (e) { setMsg("⚠ Discovery error: " + e.message); }
    setBusy(false);
  }

  const totalDone = jobs.reduce((s, j) => s + j.items.filter((i) => i.status === "done").length, 0);

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: 20, fontFamily: "Inter, system-ui, sans-serif", color: "#dfe6ee" }}>
      <div style={{ fontSize: 12, fontFamily: "monospace", color: AMBER, marginBottom: 12 }}>BACKGROUND AI LEAD SCANNER</div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12, alignItems: "center" }}>
        <input value={zip} onChange={(e) => setZip(e.target.value)} placeholder="ZIP code, e.g. 55404"
          style={{ padding: "8px 10px", background: PANEL, border: `1px solid ${LINE}`, borderRadius: 6, color: "#dfe6ee", fontSize: 13, width: 160 }} />
        <button onClick={discoverAndQueue} disabled={busy} style={{ padding: "8px 14px", background: busy ? MUTE : AMBER, border: "none", borderRadius: 6, color: "#1a1200", fontWeight: 700, cursor: busy ? "default" : "pointer", fontSize: 13 }}>{busy ? "Discovering…" : "Discover + queue scan"}</button>
        <span style={{ fontSize: 12, color: GREEN }}>{totalDone} scanned this session</span>
      </div>
      {msg && <div style={{ fontSize: 12, color: MUTE, marginBottom: 12 }}>{msg}</div>}

      {jobs.length === 0 ? (
        <div style={{ background: "#0b0f16", border: `1px solid ${LINE}`, borderRadius: 8, padding: 20, fontSize: 13, color: MUTE }}>
          Queue a ZIP to begin. Scans run through the Background Processing Engine — they keep running while you use other tabs, resume automatically if you close the browser mid-run, and retry failures automatically. Full progress detail is on the <a href="/jobs" style={{ color: BLUE }}>Jobs</a> page.
        </div>
      ) : (
        jobs.map((job) => {
          const done = job.items.filter((i) => i.status === "done").length;
          const failed = job.items.filter((i) => i.status === "failed").length;
          const total = job.items.length;
          return (
            <div key={job.id} style={{ background: PANEL, border: `1px solid ${LINE}`, borderRadius: 8, padding: 14, marginBottom: 10 }}>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>{job.label} — <span style={{ color: MUTE, fontWeight: 400 }}>{job.status}</span></div>
              <div style={{ height: 8, background: "#0b0f16", borderRadius: 4, overflow: "hidden", marginBottom: 6 }}>
                <div style={{ width: `${total ? ((done + failed) / total) * 100 : 0}%`, height: "100%", background: failed > done ? "#e5534b" : GREEN }} />
              </div>
              <div style={{ fontSize: 12, color: MUTE }}>{done}/{total} done{failed ? `, ${failed} failed` : ""}</div>
            </div>
          );
        })
      )}
      <div style={{ fontSize: 12, color: MUTE, marginTop: 12 }}>See <a href="/jobs" style={{ color: BLUE }}>Jobs</a> for pause/resume/retry controls and every job across the app.</div>
    </div>
  );
}
