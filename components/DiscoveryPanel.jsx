"use client";
import { useEffect, useState, useRef } from "react";
import { enqueueJob, runQueue, subscribe, requestNotifyPermission } from "../lib/jobQueue";
import { upsertLead } from "../lib/leadStore";

const AMBER = "#f5a623", PANEL = "#141b26", LINE = "#232f3e", MUTE = "#6b7c93", GREEN = "#4caf7d", BLUE = "#2e7dd1", RED = "#e5534b";

// Autonomous Property Discovery: search by ZIP, city, county, or draw an
// area on the map. Every discovered address is queued through the
// Background Processing Engine, which reverse-geocodes, pulls imagery,
// scores damage, and auto-populates the CRM — one click from search to
// lead generation.
async function discoverAddressJob(item) {
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

  const lead = { address: item.address, lat, lon, findingsScore: scan.concern_score, confidence: scan.confidence, indicators: scan.indicators || [], notes: scan.notes || "", imagery: [dataUrl], source: "discovery" };
  upsertLead(lead);
  return lead;
}

const HANDLERS = { "discover-address": discoverAddressJob };

export default function DiscoveryPanel() {
  const [mode, setMode] = useState("zip");
  const [query, setQuery] = useState("");
  const [drawing, setDrawing] = useState(false);
  const [points, setPoints] = useState([]);
  const [found, setFound] = useState([]);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const mapRef = useRef(null);
  const mapInstance = useRef(null);
  const [mapReady, setMapReady] = useState(false);

  useEffect(() => { requestNotifyPermission(); runQueue(HANDLERS); }, []);

  // Load Mapbox for the "draw an area" mode only when selected.
  useEffect(() => {
    if (mode !== "polygon") return;
    const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
    if (!token) return;
    if (window.mapboxgl) { setMapReady(true); return; }
    const link = document.createElement("link"); link.rel = "stylesheet"; link.href = "https://api.mapbox.com/mapbox-gl-js/v3.4.0/mapbox-gl.css"; document.head.appendChild(link);
    const script = document.createElement("script"); script.src = "https://api.mapbox.com/mapbox-gl-js/v3.4.0/mapbox-gl.js"; script.onload = () => setMapReady(true); document.head.appendChild(script);
  }, [mode]);

  useEffect(() => {
    const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
    if (mode !== "polygon" || !mapReady || !mapRef.current || mapInstance.current || !token?.startsWith("pk.")) return;
    window.mapboxgl.accessToken = token;
    const map = new window.mapboxgl.Map({ container: mapRef.current, style: "mapbox://styles/mapbox/dark-v11", center: [-93.26, 44.98], zoom: 11 });
    map.addControl(new window.mapboxgl.NavigationControl(), "top-right");
    map.on("load", () => {
      map.addSource("draw-poly", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({ id: "draw-fill", type: "fill", source: "draw-poly", paint: { "fill-color": "#f5a623", "fill-opacity": 0.15 } });
      map.addLayer({ id: "draw-line", type: "line", source: "draw-poly", paint: { "line-color": "#f5a623", "line-width": 2 } });
      map.addLayer({ id: "draw-points", type: "circle", source: "draw-poly", filter: ["==", "$type", "Point"], paint: { "circle-color": "#f5a623", "circle-radius": 5 } });
    });
    map.on("click", (e) => {
      setPoints((prev) => [...prev, { lat: e.lngLat.lat, lon: e.lngLat.lng }]);
    });
    mapInstance.current = map;
  }, [mode, mapReady]);

  useEffect(() => {
    const map = mapInstance.current;
    if (!map || !map.getSource || !map.getSource("draw-poly")) return;
    const coords = points.map((p) => [p.lon, p.lat]);
    const features = [];
    if (coords.length >= 3) features.push({ type: "Feature", geometry: { type: "Polygon", coordinates: [[...coords, coords[0]]] }, properties: {} });
    coords.forEach((c) => features.push({ type: "Feature", geometry: { type: "Point", coordinates: c }, properties: {} }));
    map.getSource("draw-poly").setData({ type: "FeatureCollection", features });
  }, [points]);

  async function search() {
    setMsg(""); setFound([]); setBusy(true);
    try {
      let res, data;
      if (mode === "zip") {
        if (!/^\d{5}$/.test(query.trim())) { setMsg("Enter a valid 5-digit ZIP."); setBusy(false); return; }
        res = await fetch(`/api/zip-scan?zip=${query.trim()}&max=50`);
        data = await res.json();
      } else if (mode === "polygon") {
        if (points.length < 3) { setMsg("Click at least 3 points on the map to draw an area."); setBusy(false); return; }
        res = await fetch("/api/discover", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: "polygon", polygon: points, max: 60 }) });
        data = await res.json();
      } else {
        if (!query.trim()) { setMsg(`Enter a ${mode} name.`); setBusy(false); return; }
        res = await fetch("/api/discover", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode, query: query.trim(), max: 60 }) });
        data = await res.json();
      }
      if (!data.ok) { setMsg(data.error || "Discovery failed."); setBusy(false); return; }
      setFound(data.addresses || []);
      setMsg(`Found ${data.addresses?.length || 0} propert${data.addresses?.length === 1 ? "y" : "ies"}${data.city ? ` in ${data.city}${data.state ? ", " + data.state : ""}` : ""}.`);
    } catch (e) { setMsg("Error: " + e.message); }
    setBusy(false);
  }

  function queueAll() {
    if (!found.length) return;
    enqueueJob({ type: "discover-address", label: `Discovery: ${query || "drawn area"}`, items: found });
    runQueue(HANDLERS);
    setMsg(`Queued ${found.length} properties for automatic AI analysis — see Jobs for progress.`);
  }

  return (
    <div style={{ maxWidth: 1000, margin: "0 auto", padding: 20, fontFamily: "Inter, system-ui, sans-serif", color: "#dfe6ee" }}>
      <div style={{ fontSize: 12, fontFamily: "monospace", color: AMBER, marginBottom: 12 }}>AUTONOMOUS PROPERTY DISCOVERY</div>

      <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
        {["zip", "city", "county", "polygon"].map((m) => (
          <button key={m} onClick={() => { setMode(m); setFound([]); setMsg(""); }}
            style={{ padding: "8px 14px", background: mode === m ? AMBER : "transparent", color: mode === m ? "#1a1200" : MUTE, border: `1px solid ${mode === m ? AMBER : LINE}`, borderRadius: 6, fontWeight: mode === m ? 700 : 500, cursor: "pointer", fontSize: 13, textTransform: "capitalize" }}>
            {m === "polygon" ? "Draw area on map" : m}
          </button>
        ))}
      </div>

      {mode !== "polygon" ? (
        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={mode === "zip" ? "ZIP code, e.g. 55404" : `${mode[0].toUpperCase()}${mode.slice(1)} name, e.g. ${mode === "city" ? "Minneapolis, MN" : "Hennepin County, MN"}`}
            style={{ flex: 1, padding: "8px 10px", background: PANEL, border: `1px solid ${LINE}`, borderRadius: 6, color: "#dfe6ee", fontSize: 13 }} />
          <button onClick={search} disabled={busy} style={{ padding: "8px 16px", background: busy ? MUTE : BLUE, border: "none", borderRadius: 6, color: "#fff", fontWeight: 700, cursor: busy ? "default" : "pointer", fontSize: 13 }}>{busy ? "Searching…" : "Search"}</button>
        </div>
      ) : (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 12, color: MUTE, marginBottom: 8 }}>Click at least 3 points on the map to draw a search area, then Search. ({points.length} point{points.length === 1 ? "" : "s"})</div>
          <div ref={mapRef} style={{ height: 360, borderRadius: 8, border: `1px solid ${LINE}`, marginBottom: 8 }} />
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={search} disabled={busy || points.length < 3} style={{ padding: "8px 16px", background: busy || points.length < 3 ? MUTE : BLUE, border: "none", borderRadius: 6, color: "#fff", fontWeight: 700, cursor: busy ? "default" : "pointer", fontSize: 13 }}>{busy ? "Searching…" : "Search this area"}</button>
            <button onClick={() => setPoints([])} style={{ padding: "8px 16px", background: "transparent", border: `1px solid ${LINE}`, borderRadius: 6, color: RED, cursor: "pointer", fontSize: 13 }}>Clear points</button>
          </div>
        </div>
      )}

      {msg && <div style={{ fontSize: 13, color: found.length ? GREEN : MUTE, marginBottom: 12 }}>{msg}</div>}

      {found.length > 0 && (
        <div style={{ background: PANEL, border: `1px solid ${LINE}`, borderRadius: 10, overflow: "hidden", marginBottom: 12, maxHeight: 300, overflowY: "auto" }}>
          {found.map((a, i) => <div key={i} style={{ padding: "8px 14px", borderTop: i ? `1px solid ${LINE}` : "none", fontSize: 13 }}>{a.address}</div>)}
        </div>
      )}

      {found.length > 0 && (
        <button onClick={queueAll} style={{ padding: "10px 18px", background: AMBER, border: "none", borderRadius: 6, color: "#1a1200", fontWeight: 700, cursor: "pointer", fontSize: 14 }}>
          Queue all {found.length} for AI analysis + auto-populate CRM →
        </button>
      )}

      <div style={{ fontSize: 12, color: MUTE, marginTop: 16 }}>Discovered addresses are reverse-geocoded, imaged, damage-scored, and added to the CRM automatically by the <a href="/jobs" style={{ color: BLUE }}>Background Processing Engine</a> — no manual property entry.</div>
    </div>
  );
}
