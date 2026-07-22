"use client";
import { useEffect, useRef, useState, useCallback } from "react";
import { loadLeads, importConsoleProperties } from "../lib/leadStore";
import LeadDetailDrawer from "./LeadDetailDrawer";

const SLATE = "#0d1420", PANEL = "#131c2b", LINE = "#22304a", TEXT = "#dfe6ee", MUTE = "#77839a";
const AMBER = "#f5b942", BLUE = "#4fa3e3", GREEN = "#4fc98e";

const TIER_COLORS = { hot: "#ef5a6f", warm: "#f5b942", cool: "#4fa3e3", cold: "#77839a", "low-priority": "#8a6bd1", unscored: "#444e5e" };
const TIER_LABELS = { hot: "🔴 Hot Lead", warm: "🟡 Warm Lead", cool: "🔵 Cool Lead", cold: "⚫ Cold", "low-priority": "🟣 Low Priority (permit <10y)", unscored: "⬜ Not yet scored" };

function tierOf(item) {
  if (item.lowPriority) return "low-priority";
  const s = item.findingsScore;
  if (s === null || s === undefined) return "unscored";
  if (s >= 75) return "hot";
  if (s >= 50) return "warm";
  if (s >= 25) return "cool";
  return "cold";
}

const SOURCE_ID = "leads-src";

export default function LeadMap() {
  const mapRef = useRef(null);
  const mapInstance = useRef(null);
  const [items, setItems] = useState([]);
  const [tierFilter, setTierFilter] = useState("all");
  const [minScore, setMinScore] = useState(0);
  const [search, setSearch] = useState("");
  const [heatmap, setHeatmap] = useState(false);
  const [selected, setSelected] = useState(null);
  const [mapReady, setMapReady] = useState(false);
  const [stats, setStats] = useState({});

  const refreshItems = useCallback(() => {
    const leads = importConsoleProperties();
    const withCoords = leads.filter((it) => it.lat && it.lon);
    setItems(withCoords);
    const s = {};
    withCoords.forEach((it) => { const t = tierOf(it); s[t] = (s[t] || 0) + 1; });
    setStats(s);
  }, []);

  useEffect(() => { refreshItems(); }, [refreshItems]);

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
    if (!mapReady || !mapRef.current || mapInstance.current || !token) return;
    if (!token.startsWith("pk.")) {
      console.warn("[LeadMap] NEXT_PUBLIC_MAPBOX_TOKEN must be a public token (pk.*). Map disabled.");
      return;
    }
    try {
      window.mapboxgl.accessToken = token;
      const map = new window.mapboxgl.Map({
        container: mapRef.current, style: "mapbox://styles/mapbox/dark-v11",
        center: [-93.26, 44.98], zoom: 10,
      });
      map.addControl(new window.mapboxgl.NavigationControl(), "top-right");

      map.on("load", () => {
        map.addSource(SOURCE_ID, { type: "geojson", data: { type: "FeatureCollection", features: [] }, cluster: true, clusterRadius: 45, clusterMaxZoom: 14 });

        map.addLayer({
          id: "clusters", type: "circle", source: SOURCE_ID, filter: ["has", "point_count"],
          paint: {
            "circle-color": ["step", ["get", "point_count"], "#4fa3e3", 10, "#f5b942", 30, "#ef5a6f"],
            "circle-radius": ["step", ["get", "point_count"], 16, 10, 22, 30, 28],
            "circle-stroke-width": 2, "circle-stroke-color": "rgba(255,255,255,0.5)",
          },
        });
        map.addLayer({ id: "cluster-count", type: "symbol", source: SOURCE_ID, filter: ["has", "point_count"],
          layout: { "text-field": ["get", "point_count_abbreviated"], "text-size": 12 }, paint: { "text-color": "#0d1420" } });

        map.addLayer({
          id: "unclustered", type: "circle", source: SOURCE_ID, filter: ["!", ["has", "point_count"]],
          paint: {
            "circle-color": ["get", "color"],
            "circle-radius": ["case", ["==", ["get", "tier"], "hot"], 9, 7],
            "circle-stroke-width": 2, "circle-stroke-color": "rgba(255,255,255,0.7)",
          },
        });

        map.addLayer({
          id: "heat", type: "heatmap", source: SOURCE_ID, layout: { visibility: "none" },
          paint: {
            "heatmap-weight": ["interpolate", ["linear"], ["get", "score"], 0, 0.1, 100, 1],
            "heatmap-intensity": 1,
            "heatmap-color": ["interpolate", ["linear"], ["heatmap-density"], 0, "rgba(0,0,0,0)", 0.3, "#4fa3e3", 0.6, "#f5b942", 1, "#ef5a6f"],
            "heatmap-radius": 30, "heatmap-opacity": 0.75,
          },
        }, "clusters");

        map.on("click", "clusters", (e) => {
          const features = map.queryRenderedFeatures(e.point, { layers: ["clusters"] });
          const clusterId = features[0].properties.cluster_id;
          map.getSource(SOURCE_ID).getClusterExpansionZoom(clusterId, (err, zoom) => {
            if (err) return;
            map.easeTo({ center: features[0].geometry.coordinates, zoom });
          });
        });
        map.on("click", "unclustered", (e) => {
          const addr = e.features[0].properties.address;
          setItems((cur) => { const found = cur.find((it) => it.address === addr); if (found) setSelected(found); return cur; });
        });
        map.on("mouseenter", "unclustered", () => { map.getCanvas().style.cursor = "pointer"; });
        map.on("mouseleave", "unclustered", () => { map.getCanvas().style.cursor = ""; });
        map.on("mouseenter", "clusters", () => { map.getCanvas().style.cursor = "pointer"; });
        map.on("mouseleave", "clusters", () => { map.getCanvas().style.cursor = ""; });

        mapInstance.current = map;
        setMapReady((v) => v);
      });
    } catch (e) {
      console.error("[LeadMap] Mapbox init failed:", e.message);
    }
  }, [mapReady]);

  useEffect(() => {
    const map = mapInstance.current;
    if (!map || !map.getSource || !map.getSource(SOURCE_ID)) return;

    const q = search.trim().toLowerCase();
    const visible = items.filter((it) => {
      if (tierFilter !== "all" && tierOf(it) !== tierFilter) return false;
      if ((it.findingsScore ?? 0) < minScore) return false;
      if (q && !it.address?.toLowerCase().includes(q)) return false;
      return true;
    });

    const features = visible.map((it) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [parseFloat(it.lon), parseFloat(it.lat)] },
      properties: { address: it.address, score: it.findingsScore ?? 0, tier: tierOf(it), color: TIER_COLORS[tierOf(it)] },
    }));
    map.getSource(SOURCE_ID).setData({ type: "FeatureCollection", features });

    if (features.length) {
      const lons = features.map((f) => f.geometry.coordinates[0]);
      const lats = features.map((f) => f.geometry.coordinates[1]);
      map.fitBounds([[Math.min(...lons) - 0.01, Math.min(...lats) - 0.01], [Math.max(...lons) + 0.01, Math.max(...lats) + 0.01]], { padding: 60, maxZoom: 15 });
    }
  }, [items, tierFilter, minScore, search, mapReady]);

  useEffect(() => {
    const map = mapInstance.current;
    if (!map || !map.getLayer || !map.getLayer("heat")) return;
    map.setLayoutProperty("heat", "visibility", heatmap ? "visible" : "none");
    map.setLayoutProperty("clusters", "visibility", heatmap ? "none" : "visible");
    map.setLayoutProperty("cluster-count", "visibility", heatmap ? "none" : "visible");
    map.setLayoutProperty("unclustered", "visibility", heatmap ? "none" : "visible");
  }, [heatmap, mapReady]);

  const token = typeof process !== "undefined" ? process.env.NEXT_PUBLIC_MAPBOX_TOKEN : null;

  return (
    <div style={{ minHeight: "100vh", background: SLATE, color: TEXT, fontFamily: "Inter, system-ui, sans-serif", display: "flex", flexDirection: "column" }}>
      <div style={{ padding: "18px 24px", borderBottom: `1px solid ${LINE}`, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
        <div>
          <div style={{ fontSize: 11, letterSpacing: 2, color: AMBER, fontFamily: "monospace" }}>AEROLEADAI</div>
          <h1 style={{ fontSize: 20, margin: "4px 0 0" }}>Interactive Damage Intelligence Map</h1>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <a href="/discovery" style={{ padding: "7px 14px", border: `1px solid ${LINE}`, borderRadius: 6, color: BLUE, fontSize: 13, textDecoration: "none" }}>+ Discover properties</a>
          <a href="/batch" style={{ padding: "7px 14px", border: `1px solid ${LINE}`, borderRadius: 6, color: BLUE, fontSize: 13, textDecoration: "none" }}>← Batch pipeline</a>
          <a href="/" style={{ padding: "7px 14px", border: `1px solid ${LINE}`, borderRadius: 6, color: BLUE, fontSize: 13, textDecoration: "none" }}>Deep-dive →</a>
        </div>
      </div>

      <div style={{ display: "flex", gap: 14, alignItems: "center", padding: "12px 24px", flexWrap: "wrap", borderBottom: `1px solid ${LINE}` }}>
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search address…"
          style={{ padding: "7px 10px", background: PANEL, border: `1px solid ${LINE}`, borderRadius: 6, color: TEXT, fontSize: 13, minWidth: 180 }} />
        <label style={{ fontSize: 12, color: MUTE, display: "flex", alignItems: "center", gap: 6 }}>
          Min score
          <input type="range" min={0} max={100} value={minScore} onChange={(e) => setMinScore(+e.target.value)} />
          <span style={{ color: TEXT }}>{minScore}</span>
        </label>
        <label style={{ fontSize: 12, color: MUTE, display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
          <input type="checkbox" checked={heatmap} onChange={(e) => setHeatmap(e.target.checked)} /> Heat map
        </label>
        <button onClick={refreshItems} style={{ padding: "6px 12px", background: "transparent", border: `1px solid ${LINE}`, borderRadius: 6, color: GREEN, fontSize: 12, cursor: "pointer" }}>↻ Refresh</button>
      </div>

      <div style={{ display: "flex", gap: 10, padding: "12px 24px", overflowX: "auto" }}>
        {Object.entries(TIER_COLORS).map(([tier, color]) => (
          <button key={tier} onClick={() => setTierFilter(tierFilter === tier ? "all" : tier)}
            style={{ padding: "8px 14px", borderRadius: 20, border: `2px solid ${tierFilter === tier || tierFilter === "all" ? color : LINE}`, background: tierFilter === tier ? color + "22" : "transparent", color: tierFilter === tier ? color : MUTE, fontSize: 12, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" }}>
            {TIER_LABELS[tier]} {stats[tier] ? `(${stats[tier]})` : "(0)"}
          </button>
        ))}
        {tierFilter !== "all" && (
          <button onClick={() => setTierFilter("all")} style={{ padding: "8px 14px", borderRadius: 20, border: `1px solid ${LINE}`, background: "transparent", color: TEXT, fontSize: 12, cursor: "pointer" }}>Show all</button>
        )}
      </div>

      <div style={{ flex: 1, display: "flex", minHeight: 0, position: "relative" }}>
        <div ref={mapRef} style={{ flex: 1, minHeight: 500 }} />

        {!token && (
          <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)", background: PANEL, border: `1px solid ${LINE}`, borderRadius: 10, padding: 24, textAlign: "center", maxWidth: 340 }}>
            <div style={{ fontSize: 24, marginBottom: 8 }}>🗺️</div>
            <div style={{ fontWeight: 700, marginBottom: 8 }}>Map needs NEXT_PUBLIC_MAPBOX_TOKEN</div>
            <div style={{ fontSize: 13, color: MUTE }}>Add your Mapbox public token (pk.*) as NEXT_PUBLIC_MAPBOX_TOKEN in Vercel environment variables and redeploy.</div>
          </div>
        )}

        {items.length === 0 && token && (
          <div style={{ position: "absolute", top: "55%", left: "40%", transform: "translate(-50%,-50%)", textAlign: "center", color: MUTE }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>📍</div>
            <div>No scored leads yet.</div>
            <a href="/discovery" style={{ color: BLUE, fontSize: 14 }}>Discover properties →</a>
          </div>
        )}
      </div>

      {selected && (
        <LeadDetailDrawer lead={selected} onClose={() => setSelected(null)}
          onChange={() => { refreshItems(); setSelected((cur) => cur && items.find((it) => it.address === cur.address)); }} />
      )}
    </div>
  );
}
