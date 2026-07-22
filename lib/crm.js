"use client";
// CRM utilities: one-click CSV export, follow-up reminders, and a
// nearest-neighbor canvassing route optimizer with a Google Maps handoff.

export function leadsToCsv(leads) {
  const cols = ["address", "status", "findingsScore", "confidence", "estValue", "followUp", "lat", "lon", "createdAt"];
  const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const rows = [cols.join(",")];
  leads.forEach((l) => rows.push(cols.map((c) => esc(l[c])).join(",")));
  return rows.join("\n");
}

export function downloadCsv(leads, filename = "aeroleadai-leads.csv") {
  const blob = new Blob([leadsToCsv(leads)], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

export function overdueFollowUps(leads) {
  const now = Date.now();
  return leads.filter((l) => l.followUp && new Date(l.followUp).getTime() <= now && !["won", "lost"].includes(l.status));
}

// Nearest-neighbor route through leads with coordinates. Fine for door
// knocking (<50 stops); not a TSP solver and doesn't pretend to be.
export function optimizeRoute(leads, start = null) {
  const stops = leads.filter((l) => l.lat && l.lon).map((l) => ({ ...l, lat: +l.lat, lon: +l.lon }));
  if (stops.length < 2) return stops;
  const dist = (a, b) => Math.hypot(a.lat - b.lat, (a.lon - b.lon) * Math.cos((a.lat * Math.PI) / 180));
  const route = [];
  let cur = start ? { lat: +start.lat, lon: +start.lon } : stops.shift();
  if (!start) route.push(cur);
  while (stops.length) {
    let bi = 0, bd = Infinity;
    stops.forEach((s, i) => { const d = dist(cur, s); if (d < bd) { bd = d; bi = i; } });
    cur = stops.splice(bi, 1)[0];
    route.push(cur);
  }
  return route;
}

export function routeToGoogleMapsUrl(route) {
  const pts = route.slice(0, 10).map((r) => `${r.lat},${r.lon}`); // Maps caps waypoints
  return `https://www.google.com/maps/dir/${pts.join("/")}`;
}
