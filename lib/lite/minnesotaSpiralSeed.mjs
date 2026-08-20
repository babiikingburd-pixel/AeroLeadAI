const HENNEPIN_PARCEL_QUERY =
  "https://gis.hennepin.us/arcgis/rest/services/HennepinData/LAND_PROPERTY/MapServer/1/query";

const SOURCE_FIELDS = [
  "PID",
  "HOUSE_NO",
  "FRAC_HOUSE_NO",
  "STREET_NM",
  "ZIP_CD",
  "MUNIC_NM",
  "BUILD_YR",
  "PR_TYP_NM1",
  "MKT_VAL_TOT",
  "MULTI_ADDR_IND",
  "CONDO_NO",
  "PROPERTY_STATUS_CD",
  "LAT",
  "LON",
];

const EARTH_RADIUS_MILES = 3958.7613;
const PAGE_SIZE = 2000;
const WRITE_BATCH_SIZE = 100;
const DEFAULT_IMPORT_LIMIT = 100;
const DEFAULT_RADIUS_MILES = 0.5;
const DEFAULT_RING_WIDTH_MILES = 0.05;
const MAX_HENNEPIN_RADIUS_MILES = 35;

export const CEDAR_SPIRAL_SEED = Object.freeze({
  id: "cedar-8600",
  inputAddress: "8600 Cedar Ave S, Bloomington, MN 55425",
  canonicalAddress: "8600 Old Cedar Ave S, Bloomington, MN 55425",
  latitude: 44.847598575765005,
  longitude: -93.24879799628836,
});

const clean = (value) => String(value ?? "").trim().replace(/\s+/g, " ");
const numberOrNull = (value) => {
  if (value === null || value === undefined || (typeof value === "string" && !value.trim())) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};
const radians = (degrees) => (degrees * Math.PI) / 180;
const degrees = (radiansValue) => (radiansValue * 180) / Math.PI;

export function haversineMiles(latitude, longitude, seed = CEDAR_SPIRAL_SEED) {
  const lat1 = radians(seed.latitude);
  const lat2 = radians(latitude);
  const deltaLat = lat2 - lat1;
  const deltaLon = radians(longitude - seed.longitude);
  const a =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2;
  return EARTH_RADIUS_MILES * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function bearingDegrees(latitude, longitude, seed = CEDAR_SPIRAL_SEED) {
  const lat1 = radians(seed.latitude);
  const lat2 = radians(latitude);
  const deltaLon = radians(longitude - seed.longitude);
  const y = Math.sin(deltaLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(deltaLon);
  return (degrees(Math.atan2(y, x)) + 360) % 360;
}

export function normalizeHennepinParcel(attributes = {}, observedAt = new Date().toISOString()) {
  const parcelId = clean(attributes.PID);
  const latitude = numberOrNull(attributes.LAT);
  const longitude = numberOrNull(attributes.LON);
  const propertyType = clean(attributes.PR_TYP_NM1).toUpperCase();
  const multiAddress = clean(attributes.MULTI_ADDR_IND).toLowerCase();
  const condoNumber = clean(attributes.CONDO_NO);
  const status = clean(attributes.PROPERTY_STATUS_CD);
  const houseNumber = clean(attributes.HOUSE_NO);
  const fraction = clean(attributes.FRAC_HOUSE_NO);
  const street = clean(attributes.STREET_NM);

  // This is deliberately stricter than a broad "residential" text match.
  // Apartments, condos, duplexes, townhomes, multi-address parcels, inactive
  // records and the multifamily seed building cannot enter the candidate pool.
  if (
    !parcelId ||
    propertyType !== "RESIDENTIAL" ||
    condoNumber ||
    ["y", "yes", "true", "1"].includes(multiAddress) ||
    (status && status !== "0") ||
    !houseNumber ||
    !street ||
    latitude === null ||
    longitude === null
  ) {
    return null;
  }

  const address = clean([houseNumber, fraction, street].filter(Boolean).join(" "));
  const distance = haversineMiles(latitude, longitude);
  const bearing = bearingDegrees(latitude, longitude);
  const yearBuilt = Number.parseInt(clean(attributes.BUILD_YR), 10);
  const assessedValue = numberOrNull(attributes.MKT_VAL_TOT);

  // 8600 Old Cedar is Cedar Commons Apartments. It is the map origin only,
  // never a roofing lead, even if the upstream classification later changes.
  if (/^8600\s+(?:old\s+)?cedar\s+ave\s+s\b/i.test(address)) return null;

  return {
    id: `mn-hennepin-${parcelId}`,
    parcel_id: parcelId,
    parcel_source_id: parcelId,
    parcel_source_updated_at: observedAt,
    address,
    city: clean(attributes.MUNIC_NM).toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase()),
    county: "Hennepin",
    state: "MN",
    zip: clean(attributes.ZIP_CD),
    lat: latitude,
    lon: longitude,
    year_built: Number.isInteger(yearBuilt) && yearBuilt > 1700 ? yearBuilt : null,
    assessed_value: assessedValue,
    property_class: "single-family residential",
    property_use_type: "single-family residential",
    residential_status: "verified",
    residential_confidence: 100,
    value_evidence_status: "verified",
    assessor_checked_at: observedAt,
    value_checked_at: observedAt,
    permit_within_10y: null,
    permit_evidence_status: "pending",
    storm_evidence_status: "pending",
    image_review_status: "missing",
    review_status: "pending",
    sales_status: "new",
    stage: "queued",
    source: "hennepin-county-parcel-monthly",
    tags: ["aerolead-lite", "cedar-8600-spiral", "official-parcel", "single-family"],
    excluded: false,
    spiral_seed_id: CEDAR_SPIRAL_SEED.id,
    spiral_distance_miles: Number(distance.toFixed(6)),
    spiral_bearing_degrees: Number(bearing.toFixed(6)),
    spiral_ring: Math.floor(distance / DEFAULT_RING_WIDTH_MILES),
    updated_at: observedAt,
  };
}

function compareSpiral(left, right) {
  return (
    left.spiral_ring - right.spiral_ring ||
    left.spiral_bearing_degrees - right.spiral_bearing_degrees ||
    left.spiral_distance_miles - right.spiral_distance_miles ||
    left.parcel_source_id.localeCompare(right.parcel_source_id)
  );
}

function followsCursor(row, frontier) {
  const ring = Number(frontier.last_ring ?? -1);
  if (row.spiral_ring !== ring) return row.spiral_ring > ring;
  const bearing = Number(frontier.last_bearing_degrees ?? -1);
  if (row.spiral_bearing_degrees !== bearing) return row.spiral_bearing_degrees > bearing;
  const distance = Number(frontier.last_distance_miles ?? -1);
  if (row.spiral_distance_miles !== distance) return row.spiral_distance_miles > distance;
  return row.parcel_source_id > clean(frontier.last_source_id);
}

function circleRing(radiusMiles, clockwise) {
  const latitudeDelta = radiusMiles / 69;
  const longitudeDelta = radiusMiles / (69 * Math.cos(radians(CEDAR_SPIRAL_SEED.latitude)));
  return Array.from({ length: 65 }, (_, index) => {
    const step = (index % 64) * (360 / 64);
    const angle = radians(clockwise ? step : 360 - step);
    return [
      CEDAR_SPIRAL_SEED.longitude + longitudeDelta * Math.sin(angle),
      CEDAR_SPIRAL_SEED.latitude + latitudeDelta * Math.cos(angle),
    ];
  });
}

function annulusGeometry(outerRadiusMiles, innerRadiusMiles = 0) {
  const rings = [circleRing(outerRadiusMiles, true)];
  if (innerRadiusMiles > 0) rings.push(circleRing(innerRadiusMiles, false));
  return JSON.stringify({ rings, spatialReference: { wkid: 4326 } });
}

export async function fetchHennepinResidential(
  radiusMiles = DEFAULT_RADIUS_MILES,
  fetchImpl = fetch,
  minimumRadiusMiles = 0,
) {
  const collected = [];
  let offset = 0;
  let exceededTransferLimit = true;

  while (exceededTransferLimit) {
    const params = new URLSearchParams({
      f: "json",
      where: "PR_TYP_NM1 = 'RESIDENTIAL' AND LAT IS NOT NULL AND LON IS NOT NULL AND HOUSE_NO IS NOT NULL",
      outFields: SOURCE_FIELDS.join(","),
      returnGeometry: "false",
      geometry: annulusGeometry(radiusMiles, minimumRadiusMiles),
      geometryType: "esriGeometryPolygon",
      inSR: "4326",
      spatialRel: "esriSpatialRelIntersects",
      orderByFields: "PID ASC",
      resultOffset: String(offset),
      resultRecordCount: String(PAGE_SIZE),
    });
    const response = await fetchImpl(HENNEPIN_PARCEL_QUERY, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
      },
      body: params.toString(),
      signal: AbortSignal.timeout(18000),
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`Hennepin parcel source returned HTTP ${response.status}`);
    const body = await response.json();
    if (body.error) throw new Error(`Hennepin parcel source error: ${body.error.message || "unknown"}`);
    const features = Array.isArray(body.features) ? body.features : [];
    collected.push(...features);
    exceededTransferLimit = Boolean(body.exceededTransferLimit) && features.length > 0;
    offset += features.length;
    if (offset > 30000) throw new Error("Hennepin parcel response exceeded the bounded scan window");
  }

  const observedAt = new Date().toISOString();
  return collected
    .map((feature) => normalizeHennepinParcel(feature.attributes, observedAt))
    .filter((row) => row && row.spiral_distance_miles > minimumRadiusMiles && row.spiral_distance_miles <= radiusMiles)
    .sort(compareSpiral);
}

async function readFrontier(supabase) {
  const { data, error } = await supabase
    .from("aerolead_spiral_frontiers")
    .select("*")
    .eq("seed_id", CEDAR_SPIRAL_SEED.id)
    .maybeSingle();
  if (error) throw new Error(`Spiral frontier read failed: ${error.message}`);
  if (!data) throw new Error("Cedar spiral frontier is missing; apply the Cedar migration first");
  return data;
}

async function writeLeadBatches(supabase, rows) {
  let applied = 0;
  for (let index = 0; index < rows.length; index += WRITE_BATCH_SIZE) {
    const batch = rows.slice(index, index + WRITE_BATCH_SIZE);
    const { error } = await supabase.from("batch_leads").upsert(batch, { onConflict: "id" });
    if (error) throw new Error(`Cedar spiral lead upsert failed: ${error.message}`);
    applied += batch.length;
  }
  return applied;
}

export async function seedCedarSpiral(supabase, options = {}) {
  const limit = Math.min(Math.max(Number(options.limit) || DEFAULT_IMPORT_LIMIT, 1), 500);
  const frontier = await readFrontier(supabase);
  const ringWidth = Number(frontier.ring_width_miles) || DEFAULT_RING_WIDTH_MILES;
  let radius = Math.max(Number(frontier.current_radius_miles) || DEFAULT_RADIUS_MILES, DEFAULT_RADIUS_MILES);
  const minimumRadius = Math.max(0, Number(frontier.last_ring ?? -1) * ringWidth);
  let available = [];

  while (!available.length && radius <= MAX_HENNEPIN_RADIUS_MILES) {
    const candidates = await fetchHennepinResidential(radius, options.fetchImpl || fetch, minimumRadius);
    available = candidates.filter((row) => followsCursor(row, frontier));
    if (!available.length) radius = Number((radius + ringWidth).toFixed(6));
  }

  const selected = available.slice(0, limit);
  const applied = await writeLeadBatches(supabase, selected);
  const last = selected.at(-1);
  const now = new Date().toISOString();
  const exhausted = !last && radius > MAX_HENNEPIN_RADIUS_MILES;
  const nextFrontier = {
    current_radius_miles: Math.min(radius, MAX_HENNEPIN_RADIUS_MILES),
    imported_total: Number(frontier.imported_total || 0) + applied,
    last_run_at: now,
    last_success_at: applied ? now : frontier.last_success_at,
    status: exhausted ? "source-exhausted" : "active",
    last_error: null,
    last_run_stats: {
      source: "Hennepin County monthly parcels",
      radius_miles: radius,
      candidates_after_cursor: available.length,
      imported: applied,
      retained_limit: 500,
    },
    updated_at: now,
  };
  if (last) {
    nextFrontier.last_ring = last.spiral_ring;
    nextFrontier.last_bearing_degrees = last.spiral_bearing_degrees;
    nextFrontier.last_distance_miles = last.spiral_distance_miles;
    nextFrontier.last_source_id = last.parcel_source_id;
  }
  const { error: frontierError } = await supabase
    .from("aerolead_spiral_frontiers")
    .update(nextFrontier)
    .eq("seed_id", CEDAR_SPIRAL_SEED.id);
  if (frontierError) throw new Error(`Spiral frontier update failed: ${frontierError.message}`);

  return {
    ok: true,
    seed: CEDAR_SPIRAL_SEED.inputAddress,
    canonicalSeed: CEDAR_SPIRAL_SEED.canonicalAddress,
    source: "Hennepin County monthly parcel data",
    radiusMiles: radius,
    imported: applied,
    availableAfterCursor: available.length,
    lastParcelSourceId: last?.parcel_source_id || frontier.last_source_id || null,
  };
}
