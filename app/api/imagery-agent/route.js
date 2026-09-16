import { NextResponse } from "next/server";
import { cachePath, readJson, writeJson } from "../../../lib/inspect/store";

function esriUrl(lat, lon, zoom) {
  const n = 2 ** zoom;
  const x = Math.floor(((lon + 180) / 360) * n);
  const latRad = (lat * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n);
  return `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${zoom}/${y}/${x}`;
}

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const lat = Number(searchParams.get("lat"));
  const lon = Number(searchParams.get("lon"));
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return NextResponse.json({ ok: false, error: "lat/lon required" }, { status: 400 });
  }
  return NextResponse.json({
    ok: true,
    paid: false,
    shots: {
      overview_tight: { url: esriUrl(lat, lon, 20), source: "esri-free" },
    },
    providerNote: "PR 39 is not the production imagery path. Use PR 38 /api/imagery-agent POST.",
  });
}
