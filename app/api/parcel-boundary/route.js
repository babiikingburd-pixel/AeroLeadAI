// Real parcel boundary lookup, county by county — there's no single national
// parcel API for free (that's what a paid vendor like Regrid/Estated sells);
// this is the honest, working alternative documented elsewhere in this
// codebase (see imagery-agent's notes). Determines the county via the US
// Census Bureau's reverse-geocode (free, authoritative), then queries that
// county's public ArcGIS REST parcel layer if one is registered in
// lib/parcelSources.js. Coverage today: Hennepin County, MN (Minneapolis) —
// add more counties there, nothing else changes.

import { getCountyForPoint } from "../../../lib/censusGeo";
import { findParcelSource } from "../../../lib/parcelSources";

export async function POST(req) {
  const { lat, lon } = await req.json();
  if (!lat || !lon) return Response.json({ ok: false, error: "lat/lon required" }, { status: 400 });

  const county = await getCountyForPoint(lat, lon);
  if (!county) {
    return Response.json({ ok: false, error: "Could not determine county for these coordinates (Census lookup failed)." });
  }

  const source = findParcelSource(county.name);
  if (!source) {
    return Response.json({
      ok: false,
      error: `No parcel data source configured yet for ${county.name} County${county.state ? ", " + county.state : ""}. Add one in lib/parcelSources.js.`,
      county: county.name,
      state: county.state,
    });
  }

  try {
    const params = new URLSearchParams({
      where: "1=1",
      geometry: `${lon},${lat}`,
      geometryType: "esriGeometryPoint",
      inSR: "4326",
      outSR: "4326",
      spatialRel: "esriSpatialRelIntersects",
      outFields: Object.values(source.fields).join(","),
      returnGeometry: "true",
      f: "json",
    });
    const res = await fetch(`${source.serviceUrl}/query?${params}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (data.error) throw new Error(data.error.message || "ArcGIS query error");

    const feature = data.features?.[0];
    if (!feature) {
      return Response.json({ ok: false, error: "No parcel found at these coordinates in the county GIS data.", county: source.county, state: source.state });
    }

    const a = feature.attributes;
    const f = source.fields;
    const address = [a[f.houseNo], (a[f.street] || "").trim()].filter(Boolean).join(" ") || null;
    const rings = feature.geometry?.rings || [];

    return Response.json({
      ok: true,
      county: source.county,
      state: source.state,
      parcelId: a[f.pid] ?? null,
      address,
      city: (a[f.munic] || "").trim() || null,
      zip: a[f.zip] ?? null,
      owner: f.owner ? a[f.owner] ?? null : null,
      buildYear: f.buildYear ? a[f.buildYear] ?? null : null,
      areaSqFt: f.areaSqFt ? a[f.areaSqFt] ?? null : null,
      // GeoJSON-shaped: ArcGIS "rings" (array of [lon,lat] rings) is already
      // structurally a GeoJSON Polygon's coordinates.
      geometry: rings.length ? { type: "Polygon", coordinates: rings } : null,
      source: `${source.county} GIS (public parcel data)`,
    });
  } catch (e) {
    return Response.json({ ok: false, error: "Parcel lookup failed: " + e.message, county: source.county, state: source.state });
  }
}
