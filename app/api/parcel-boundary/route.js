// Parcel boundary polygons — there is NO national API for this. Parcel data
// lives with individual county GIS departments, each running their own
// ArcGIS REST service (or nothing public at all). This route queries
// per-county services one at a time as they get added, and reports clearly
// when a county isn't wired in yet instead of drawing a fabricated box.
//
// Scott County MN is wired first since it's AeroLeadAI's documented service
// territory and has a real public ArcGIS parcel layer. Add more counties by
// appending to COUNTY_SERVICES below once you have their GIS REST endpoint
// (usually found at <county>.gov/gis or via ArcGIS Hub search).

const COUNTY_SERVICES = {
  // key: lowercase "county, ST" as returned by reverse geocoding
  "scott county, mn": {
    // Scott County MN public ArcGIS parcel layer (query endpoint)
    url: "https://gis.co.scott.mn.us/arcgis/rest/services/Parcels/MapServer/0/query",
    type: "arcgis",
  },
  "hennepin county, mn": {
    url: "https://gis.hennepin.us/arcgis/rest/services/Property/Parcels/MapServer/0/query",
    type: "arcgis",
  },
};

async function queryArcGISParcel(serviceUrl, lat, lon) {
  // ArcGIS point-in-polygon query: find the parcel containing this point
  const params = new URLSearchParams({
    geometry: `${lon},${lat}`,
    geometryType: "esriGeometryPoint",
    inSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
    outFields: "*",
    returnGeometry: "true",
    outSR: "4326",
    f: "json",
  });
  const res = await fetch(`${serviceUrl}?${params}`);
  if (!res.ok) return null;
  const data = await res.json();
  const feature = data.features?.[0];
  if (!feature) return null;
  return {
    attributes: feature.attributes || {},
    // ArcGIS returns rings for polygons — pass through as [[lon,lat], ...] pairs
    // per ring so the map layer can render it directly.
    rings: feature.geometry?.rings || null,
  };
}

export async function POST(req) {
  const { lat, lon, county, state } = await req.json();
  if (!lat || !lon) return Response.json({ ok: false, error: "lat/lon required" }, { status: 400 });

  const key = county && state ? `${county}, ${state}`.toLowerCase() : null;
  const service = key ? COUNTY_SERVICES[key] : null;

  if (!service) {
    return Response.json({
      ok: false,
      covered: false,
      notes: county
        ? `No public parcel GIS service wired in yet for ${county}, ${state || "?"}. Currently covered: Scott County MN, Hennepin County MN. Add more counties by finding their ArcGIS REST parcel endpoint and appending to COUNTY_SERVICES in app/api/parcel-boundary/route.js.`
        : "County/state not provided — run reverse geocoding first to identify the county.",
    });
  }

  try {
    const parcel = await queryArcGISParcel(service.url, lat, lon);
    if (!parcel) {
      return Response.json({ ok: false, covered: true, notes: `No parcel found at this location in ${county}, ${state} — point may be outside a mapped parcel or on a road/right-of-way.` });
    }
    return Response.json({ ok: true, covered: true, county, state, ...parcel });
  } catch (e) {
    return Response.json({ ok: false, covered: true, notes: `Parcel query failed: ${e.message}` });
  }
}
