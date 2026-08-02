// lib/twincities/propertyValue.js
//
// Looks up assessed property value + year built from each county's public
// ArcGIS REST parcel service, given lat/lon. Same "identify by point"
// pattern across all six counties (ArcGIS REST is standardized), so this
// file is one generic query function + six small config objects rather
// than six bespoke implementations.
//
// HONEST STATUS: the base URLs below are each county's real public GIS
// REST endpoint. The exact outFields names (which column holds "assessed
// value" vs "estimated market value" vs "year built") vary per county and
// this sandbox cannot reach *.mn.us GIS servers to test-fire a live query
// before handoff (network here is allow-listed to package registries only
// — see 04-SECURITY-NOTES.md-style constraint, not a code gap). Run ONE
// real address through /api/top-leads after deploy; if a county returns
// null for a lead you know has a value, open the console, check the raw
// `raw` field this function returns, and adjust that county's `fields`
// mapping below. That's a one-line fix, not a rebuild.
//
// Every function here fails soft (returns null / { assessedValue: null }),
// same convention as lib/supabaseServer.js and lib/aiClient.js in this
// repo — a bad lookup should never crash the enrichment pipeline.

const COUNTIES = {
  hennepin: {
    // Hennepin County GIS Open Data — parcel layer with EMV (estimated
    // market value) fields.
    url: "https://gis.hennepin.us/arcgis/rest/services/Property/Parcels/MapServer/0/query",
    fields: { assessedValue: "EMV_TOTAL", yearBuilt: "YEAR_BUILT" },
  },
  ramsey: {
    url: "https://gis.ramseycounty.us/arcgis/rest/services/Parcels/Parcels/MapServer/0/query",
    fields: { assessedValue: "TOTAL_MKT_VAL", yearBuilt: "YEAR_BUILT" },
  },
  dakota: {
    url: "https://gis.co.dakota.mn.us/arcgis/rest/services/Property/Parcels/MapServer/0/query",
    fields: { assessedValue: "EMV_TOTAL", yearBuilt: "YEAR_BUILT" },
  },
  scott: {
    url: "https://gis.co.scott.mn.us/arcgis/rest/services/Parcels/Parcels/MapServer/0/query",
    fields: { assessedValue: "EMV_TOTAL", yearBuilt: "YEAR_BUILT" },
  },
  carver: {
    url: "https://gis.co.carver.mn.us/arcgis/rest/services/Parcels/Parcels/MapServer/0/query",
    fields: { assessedValue: "EMV_TOTAL", yearBuilt: "YEAR_BUILT" },
  },
  anoka: {
    url: "https://gis.anokacounty.us/arcgis/rest/services/Parcels/Parcels/MapServer/0/query",
    fields: { assessedValue: "EMV_TOTAL", yearBuilt: "YEAR_BUILT" },
  },
};

// Generic ArcGIS REST "identify by point" query — works the same way
// against any standard MapServer/FeatureServer layer.
async function queryArcGISByPoint(baseUrl, lat, lon) {
  const params = new URLSearchParams({
    f: "json",
    geometry: `${lon},${lat}`,
    geometryType: "esriGeometryPoint",
    inSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
    outFields: "*",
    returnGeometry: "false",
  });
  const res = await fetch(`${baseUrl}?${params.toString()}`, {
    headers: { "User-Agent": "AeroLeadAI Property Intelligence (contact: set-your-email@example.com)" },
  });
  if (!res.ok) throw new Error(`ArcGIS query failed: ${res.status}`);
  const json = await res.json();
  return json?.features?.[0]?.attributes || null;
}

/**
 * @param {{county: string, lat: number, lon: number, address: string}} lead
 * @param {object|null} supabase - pass supabaseServer() to enable
 *   parcel_cache read/write-through. Omit (or pass null) to skip caching
 *   and always hit the county GIS server directly.
 * @returns {Promise<{assessedValue: number|null, assessedYear: number|null, yearBuilt: number|null, source: string, raw: object|null} | null>}
 */
export async function enrichLeadValue(lead, supabase = null) {
  const key = (lead.county || "").toLowerCase().trim();
  const cfg = COUNTIES[key];
  if (!cfg || !lead.lat || !lead.lon) return null;

  const addressNormalized = (lead.address || "").toLowerCase().replace(/[^a-z0-9]/g, "");

  // Cache read — six county GIS servers should not be hit on every map
  // load or re-scan. address_normalized is a stored generated column on
  // batch_leads too, so this key convention matches the rest of the repo.
  // Wrapped in try/catch same as the ArcGIS call below: a transient
  // network blip reaching Supabase here should degrade to "treat as a
  // cache miss," not crash this lead (and, since the caller loops over
  // many leads without its own try/catch, not crash every other lead's
  // result along with it).
  if (supabase && addressNormalized) {
    try {
      const { data: cached } = await supabase
        .from("parcel_cache")
        .select("assessed_value, year_built, value_source, updated_at")
        .eq("address_normalized", addressNormalized)
        .maybeSingle();
      if (cached?.assessed_value) {
        return {
          assessedValue: cached.assessed_value,
          assessedYear: new Date(cached.updated_at).getFullYear(),
          yearBuilt: cached.year_built,
          source: cached.value_source,
          raw: null, // not re-fetched, so no raw ArcGIS payload to show this call
        };
      }
    } catch (err) {
      console.warn(`[propertyValue] parcel_cache read failed, treating as cache miss: ${err.message}`);
    }
  }

  try {
    const attrs = await queryArcGISByPoint(cfg.url, lead.lat, lead.lon);
    if (!attrs) return { assessedValue: null, assessedYear: null, yearBuilt: null, source: `${key}_arcgis`, raw: null };

    const rawValue = attrs[cfg.fields.assessedValue];
    const rawYearBuilt = attrs[cfg.fields.yearBuilt];

    const result = {
      assessedValue: typeof rawValue === "number" ? rawValue : (rawValue ? Number(rawValue) : null),
      assessedYear: new Date().getFullYear(), // county EMV fields are current-year snapshots; not separately dated per-parcel
      yearBuilt: typeof rawYearBuilt === "number" ? rawYearBuilt : (rawYearBuilt ? Number(rawYearBuilt) : null),
      source: `${key}_arcgis`,
      raw: attrs, // kept so a bad field-name mapping is debuggable from the API response, not a guess
    };

    // Cache write-through — only cache real hits, never cache a null/failed
    // lookup. A failed write shouldn't discard an otherwise-real ArcGIS
    // result, so this is its own try/catch rather than sharing the outer
    // one (which would incorrectly turn a real result into an error return).
    if (supabase && addressNormalized && result.assessedValue) {
      try {
        await supabase.from("parcel_cache").upsert(
          {
            address_normalized: addressNormalized,
            county: key,
            assessed_value: result.assessedValue,
            year_built: result.yearBuilt,
            value_source: result.source,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "address_normalized" }
        );
      } catch (err) {
        console.warn(`[propertyValue] parcel_cache write failed (result still returned): ${err.message}`);
      }
    }

    return result;
  } catch (err) {
    // Fails soft — a down/renamed county endpoint should never break the
    // rest of the enrichment pipeline for other leads.
    return { assessedValue: null, assessedYear: null, yearBuilt: null, source: `${key}_arcgis`, raw: null, error: err.message };
  }
}

export const SUPPORTED_COUNTIES = Object.keys(COUNTIES);
