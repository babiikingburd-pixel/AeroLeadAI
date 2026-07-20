"use client";
import { useEffect, useRef, useState } from "react";

const SLATE = "#0d1420", PANEL = "#131c2b", LINE = "#22304a", TEXT = "#dfe6ee", MUTE = "#77839a";
const AMBER = "#f5b942", BLUE = "#4fa3e3", GREEN = "#4fc98e", SIGNAL = "#ef5a6f";

const TIER_COLORS = {
  hot: "#ef5a6f",
  warm: "#f5b942",
  cool: "#4fa3e3",
  cold: "#77839a",
  "low-priority": "#8a6bd1",
  unscored: "#444e5e",
};

const TIER_LABELS = {
  hot: "🔴 Hot Lead",
  warm: "🟡 Warm Lead",
  cool: "🔵 Cool Lead",
  cold: "⚫ Cold",
  "low-priority": "🟣 Low Priority (permit <10y)",
  unscored: "⬜ Not yet scored",
};

const STORE_KEY = "aerolead:batch:v1";

function tierOf(item) {
  if (item.permitWithin10y) return "low-priority";
  const s = item.damageScore;
  if (s === null || s === undefined) return "unscored";
  if (s >= 75) return "hot";
  if (s >= 50) return "warm";
  if (s >= 25) return "cool";
  return "cold";
}

export default function LeadMap() {
  const mapRef = useRef(null);
  const mapInstance = useRef(null);
  const markersRef = useRef([]);
  const [items, setItems] = useState([]);
  const [filter, setFilter] = useState("all");
  const [selected, setSelected] = useState(null);
  const [mapReady, setMapReady] = useState(false);
  const [stats, setStats] = useState({});

  // Load batch data from localStorage
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        const saved = JSON.parse(raw);
        const all = (saved.order || []).map((id) => saved.items?.[id]).filter(Boolean).filter((it) => it.lat && it.lon);
        setItems(all);
        const s = {};
        all.forEach((it) => { const t = tierOf(it); s[t] = (s[t] || 0) + 1; });
        setStats(s);
      }
    } catch {}
  }, []);

  // Load Mapbox GL JS dynamically
  useEffect(() => {
    const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
    if (!token) { console.warn("NEXT_PUBLIC_MAPBOX_TOKEN not set"); return; }

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

  // Init map
  useEffect(() => {
    const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
    if (!mapReady || !mapRef.current || mapInstance.current || !token) return;
    window.mapboxgl.accessToken = token;
    mapInstance.current = new window.mapboxgl.Map({
      container: mapRef.current,
      style: "mapbox://styles/mapbox/dark-v11",
      center: [-93.26, 44.98], // Twin Cities default
      zoom: 10,
    });
    mapInstance.current.addControl(new window.mapboxgl.NavigationControl(), "top-right");
  }, [mapReady]);

  // Plot markers whenever items or filter changes
  useEffect(() => {
    if (!mapInstance.current || !mapReady) return;

    // Remove old markers
    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];

    const visible = filter === "all" ? items : items.filter((it) => tierOf(it) === filter);
    if (!visible.length) return;

    // Fit map to bounds
    const lons = visible.map((it) => parseFloat(it.lon));
    const lats = visible.map((it) => parseFloat(it.lat));
    const bounds = [[Math.min(...lons) - 0.01, Math.min(...lats) - 0.01], [Math.max(...lons) + 0.01, Math.max(...lats) + 0.01]];
    mapInstance.current.fitBounds(bounds, { padding: 60, maxZoom: 15 });

    visible.forEach((it) => {
      const tier = tierOf(it);
      const color = TIER_COLORS[tier];

      // Custom colored dot marker
      const el = document.createElement("div");
      el.style.cssText = `
        width: ${tier === "hot" ? 18 : 13}px;
        height: ${tier === "hot" ? 18 : 13}px;
        background: ${color};
        border-radius: 50%;
        border: 2px solid rgba(255,255,255,0.7);
        cursor: pointer;
        box-shadow: 0 0 ${tier === "hot" ? "8px 3px" : "4px 1px"} ${color}88;
        transition: transform 0.15s;
      `;
      el.onmouseenter = () => { el.style.transform = "scale(1.4)"; };
      el.onmouseleave = () => { el.style.transform = "scale(1)"; };

      const marker = new window.mapboxgl.Marker({ element: el })
        .setLngLat([parseFloat(it.lon), parseFloat(it.lat)])
        .addTo(mapInstance.current);

      el.onclick = () => setSelected(it);
      markersRef.current.push(marker);
    });
  }, [items, filter, mapReady]);

  const token = typeof process !== "undefined" ? process.env.NEXT_PUBLIC_MAPBOX_TOKEN : null;

  return (
    <div style={{ minHeight: "100vh", background: SLATE, color: TEXT, fontFamily: "Inter, system-ui, sans-serif", display: "flex", flexDirection: "column" }}>
      {/* Header */}
      <div style={{ padding: "18px 24px", borderBottom: `1px solid ${LINE}`, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
        <div>
          <div style={{ fontSize: 11, letterSpacing: 2, color: AMBER, fontFamily: "monospace" }}>AEROLEADAI</div>
          <h1 style={{ fontSize: 20, margin: "4px 0 0" }}>Lead Intelligence Map</h1>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <a href="/batch" style={{ padding: "7px 14px", border: `1px solid ${LINE}`, borderRadius: 6, color: BLUE, fontSize: 13, textDecoration: "none" }}>← Batch pipeline</a>
          <a href="/" style={{ padding: "7px 14px", border: `1px solid ${LINE}`, borderRadius: 6, color: BLUE, fontSize: 13, textDecoration: "none" }}>Deep-dive →</a>
        </div>
      </div>

      {/* Stats strip */}
      <div style={{ display: "flex", gap: 10, padding: "12px 24px", overflowX: "auto" }}>
        {Object.entries(TIER_COLORS).map(([tier, color]) => (
          <button key={tier} onClick={() => setFilter(filter === tier ? "all" : tier)}
            style={{ padding: "8px 14px", borderRadius: 20, border: `2px solid ${filter === tier || filter === "all" ? color : LINE}`, background: filter === tier ? color + "22" : "transparent", color: filter === tier ? color : MUTE, fontSize: 12, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" }}>
            {TIER_LABELS[tier]} {stats[tier] ? `(${stats[tier]})` : "(0)"}
          </button>
        ))}
        {filter !== "all" && (
          <button onClick={() => setFilter("all")} style={{ padding: "8px 14px", borderRadius: 20, border: `1px solid ${LINE}`, background: "transparent", color: TEXT, fontSize: 12, cursor: "pointer" }}>Show all</button>
        )}
      </div>

      {/* Map + sidebar */}
      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
        <div ref={mapRef} style={{ flex: 1, minHeight: 500 }} />

        {/* Selected property sidebar */}
        {selected && (
          <div style={{ width: 280, background: PANEL, borderLeft: `1px solid ${LINE}`, padding: 18, overflowY: "auto", flexShrink: 0 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
              <b style={{ fontSize: 13 }}>Property Detail</b>
              <button onClick={() => setSelected(null)} style={{ background: "none", border: "none", color: MUTE, cursor: "pointer", fontSize: 18 }}>×</button>
            </div>
            <div style={{ fontSize: 11, color: MUTE, marginBottom: 4 }}>ADDRESS</div>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12, lineHeight: 1.4 }}>{selected.address}</div>

            {selected.dataUrl && (
              <img src={selected.dataUrl} alt="" style={{ width: "100%", borderRadius: 8, marginBottom: 12, objectFit: "cover", height: 140 }} />
            )}

            <div style={{ background: TIER_COLORS[tierOf(selected)] + "22", border: `1px solid ${TIER_COLORS[tierOf(selected)]}`, borderRadius: 8, padding: "8px 12px", marginBottom: 12 }}>
              <div style={{ color: TIER_COLORS[tierOf(selected)], fontWeight: 700, fontSize: 13 }}>{TIER_LABELS[tierOf(selected)]}</div>
              {selected.damageScore !== null && selected.damageScore !== undefined && (
                <div style={{ fontSize: 12, color: TEXT, marginTop: 4 }}>Damage score: {selected.damageScore}</div>
              )}
            </div>

            {selected.damageNotes && (
              <div style={{ fontSize: 12, color: MUTE, marginBottom: 12, lineHeight: 1.5 }}>{selected.damageNotes}</div>
            )}

            <div style={{ fontSize: 11, color: MUTE, marginBottom: 4 }}>PERMIT STATUS</div>
            <div style={{ fontSize: 12, marginBottom: 16, color: selected.permitWithin10y ? "#8a6bd1" : TEXT }}>{selected.permitNotes}</div>

            <div style={{ fontSize: 11, color: MUTE, fontFamily: "monospace" }}>
              {selected.lat && selected.lon ? `${Number(selected.lat).toFixed(5)}, ${Number(selected.lon).toFixed(5)}` : "No coords"}
            </div>

            <a href="/" onClick={() => {
              try {
                const raw = localStorage.getItem("propintel:properties");
                const props = raw ? JSON.parse(raw) : {};
                const id = Math.random().toString(36).slice(2);
                props[id] = {
                  id, address: selected.address, lat: selected.lat, lon: selected.lon,
                  parcelId: "", permitId: "", roofType: "", buildingAge: "", roofPitch: "",
                  createdAt: new Date().toISOString(),
                  folders: { images: selected.dataUrl ? [{ id, domain: "roof", dataUrl: selected.dataUrl, mediaType: "image/jpeg", uploadedAt: new Date().toISOString() }] : [], drone: [], street: [], historical: [], weather: [], permits: [], inspectionReports: [], contractorNotes: [], aiFindings: [], repairs: [], timeline: [] },
                  findingsScore: selected.damageScore, suggestedActions: [],
                };
                localStorage.setItem("propintel:properties", JSON.stringify(props));
              } catch (err) {
                // Quota exceeded — retry without the image
                try {
                  const raw2 = localStorage.getItem("propintel:properties");
                  const props2 = raw2 ? JSON.parse(raw2) : {};
                  const id2 = Math.random().toString(36).slice(2);
                  props2[id2] = {
                    id: id2, address: selected.address, lat: selected.lat, lon: selected.lon,
                    parcelId: "", permitId: "", roofType: "", buildingAge: "", roofPitch: "",
                    createdAt: new Date().toISOString(),
                    folders: { images: [], drone: [], street: [], historical: [], weather: [], permits: [], inspectionReports: [], contractorNotes: [], aiFindings: [], repairs: [], timeline: [] },
                    findingsScore: selected.damageScore, suggestedActions: [],
                  };
                  localStorage.setItem("propintel:properties", JSON.stringify(props2));
                } catch {}
              }
            }} style={{ display: "block", marginTop: 14, padding: "9px 0", background: GREEN, color: "#0d1420", borderRadius: 6, fontWeight: 700, textAlign: "center", fontSize: 13, textDecoration: "none" }}>
              Open in deep-dive →
            </a>
          </div>
        )}
      </div>

      {!token && (
        <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)", background: PANEL, border: `1px solid ${LINE}`, borderRadius: 10, padding: 24, textAlign: "center", maxWidth: 340 }}>
          <div style={{ fontSize: 24, marginBottom: 8 }}>🗺️</div>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>Map needs NEXT_PUBLIC_MAPBOX_TOKEN</div>
          <div style={{ fontSize: 13, color: MUTE }}>Add your Mapbox token as NEXT_PUBLIC_MAPBOX_TOKEN in Vercel environment variables and redeploy.</div>
        </div>
      )}

      {items.length === 0 && (
        <div style={{ position: "absolute", top: "55%", left: "40%", transform: "translate(-50%,-50%)", textAlign: "center", color: MUTE }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>📍</div>
          <div>No scored leads yet — run the batch pipeline first.</div>
          <a href="/batch" style={{ color: BLUE, fontSize: 14 }}>Go to batch pipeline →</a>
        </div>
      )}
    </div>
  );
}
