import fs from "node:fs/promises";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";

const PRIORITY_CITIES = ["EAGAN", "EDEN PRAIRIE", "SAVAGE", "SHAKOPEE"];
const DEFAULT_RADIUS_MILES = 20;
const DEFAULT_SOURCE_TABLE = process.env.OLD_DB_SOURCE_TABLE || "roof_profiles";
const SEED = {
  // Approximate center of ZIP 55431. Used only for salvage ordering/filtering,
  // never as evidence for a property record.
  latitude: Number(process.env.SALVAGE_SEED_LAT || 44.8283),
  longitude: Number(process.env.SALVAGE_SEED_LON || -93.3168),
};

function clean(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

function cityOf(row) {
  const direct = clean(row.city || row.municipality || row.property_city).toUpperCase();
  if (direct) return direct;
  const address = clean(row.address || row.site_address || row.property_address).toUpperCase();
  return PRIORITY_CITIES.find((city) => address.includes(`, ${city},`) || address.endsWith(`, ${city} MN`) || address.includes(` ${city}, MN`)) || "";
}

function coordsOf(row) {
  const latitude = Number(row.latitude ?? row.lat ?? row.property_latitude ?? row.y);
  const longitude = Number(row.longitude ?? row.lon ?? row.lng ?? row.property_longitude ?? row.x);
  return Number.isFinite(latitude) && Number.isFinite(longitude) ? { latitude, longitude } : null;
}

function haversineMiles(a, b) {
  const toRad = (degrees) => (degrees * Math.PI) / 180;
  const earthRadiusMiles = 3958.7613;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * earthRadiusMiles * Math.asin(Math.sqrt(h));
}

function canonicalIdentity(row) {
  return clean(row.parcel_id || row.parcelId || row.taxpin || row.property_id || row.id || row.address || row.site_address);
}

function usefulSubset(row) {
  const coords = coordsOf(row);
  return {
    property_id: canonicalIdentity(row) || null,
    parcel_id: clean(row.parcel_id || row.parcelId || row.taxpin) || null,
    address: clean(row.address || row.site_address || row.property_address) || null,
    city: cityOf(row) || null,
    zip: clean(row.zip || row.zip_code || row.postal_code) || null,
    latitude: coords?.latitude ?? null,
    longitude: coords?.longitude ?? null,
    property_classification: clean(row.property_classification || row.property_type || row.dwelling_type) || null,
    year_built: Number.isFinite(Number(row.year_built ?? row.yearBuilt)) ? Number(row.year_built ?? row.yearBuilt) : null,
    source_table: DEFAULT_SOURCE_TABLE,
  };
}

async function readAllRows(supabase, table) {
  const pageSize = Number(process.env.SALVAGE_PAGE_SIZE || 1000);
  const rows = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase.from(table).select("*").range(from, from + pageSize - 1);
    if (error) throw new Error(`old_db_read_failed:${table}:${error.message}`);
    rows.push(...(data || []));
    if (!data || data.length < pageSize) break;
  }
  return rows;
}

async function main() {
  const url = process.env.OLD_SUPABASE_URL;
  const key = process.env.OLD_SUPABASE_SERVICE_ROLE_KEY || process.env.OLD_SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error("Set OLD_SUPABASE_URL and OLD_SUPABASE_SERVICE_ROLE_KEY (or OLD_SUPABASE_SECRET_KEY).");

  const radiusMiles = Number(process.env.SALVAGE_RADIUS_MILES || DEFAULT_RADIUS_MILES);
  const output = process.env.SALVAGE_OUTPUT || "old-db-salvage-priority.json";
  const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const rows = await readAllRows(supabase, DEFAULT_SOURCE_TABLE);

  const deduped = new Map();
  for (const row of rows) {
    const id = canonicalIdentity(row);
    if (id && !deduped.has(id)) deduped.set(id, row);
  }

  const priority = [];
  const nearby = [];
  for (const row of deduped.values()) {
    const city = cityOf(row);
    const coords = coordsOf(row);
    const distance = coords ? haversineMiles(SEED, coords) : null;
    const item = { ...usefulSubset(row), salvage_distance_miles: distance == null ? null : Number(distance.toFixed(2)) };

    if (PRIORITY_CITIES.includes(city)) {
      priority.push(item);
      continue;
    }
    if (distance != null && distance <= radiusMiles) nearby.push(item);
  }

  const cityRank = new Map(PRIORITY_CITIES.map((city, index) => [city, index]));
  priority.sort((a, b) => (cityRank.get(a.city) ?? 999) - (cityRank.get(b.city) ?? 999) || (a.salvage_distance_miles ?? 999) - (b.salvage_distance_miles ?? 999));
  nearby.sort((a, b) => (a.salvage_distance_miles ?? 999) - (b.salvage_distance_miles ?? 999));

  const payload = {
    generated_at: new Date().toISOString(),
    purpose: "old_supabase_salvage_only",
    production_discovery_routing_changed: false,
    source_table: DEFAULT_SOURCE_TABLE,
    seed_zip: "55431",
    radius_miles: radiusMiles,
    priority_cities: PRIORITY_CITIES,
    counts: { source_rows: rows.length, unique_rows: deduped.size, priority: priority.length, nearby_other: nearby.length },
    properties: [...priority, ...nearby],
  };

  await fs.writeFile(output, JSON.stringify(payload, null, 2));
  console.log(JSON.stringify({ ok: true, output, ...payload.counts, priority_cities: PRIORITY_CITIES }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
