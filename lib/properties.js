// Item #1: every address becomes a permanent property record. This is the
// anchor everything else (timeline, graph, changes, predictions) attaches to.

import { supabaseGet, supabasePost, supabasePatch, normalizeAddress } from "./supabaseRest";

// Finds a property by normalized address, or creates it. Always returns the
// property row (with property_id) on success, or { ok:false } if Supabase
// isn't configured / the call failed — callers should degrade gracefully
// (e.g. permit-lookup still works standalone even with no property_id).
export async function findOrCreateProperty({ address, lat, lng, county, city, zip, parcelId, ownerName }) {
  if (!address) return { ok: false, error: "address required" };
  const norm = normalizeAddress(address);

  const existing = await supabaseGet(`properties?address_normalized=eq.${encodeURIComponent(norm)}&select=*&limit=1`);
  if (existing.ok && existing.data?.length) {
    const row = existing.data[0];
    // Backfill any fields we now have that the existing record is missing —
    // never overwrite a value that's already there with a null.
    const patch = {};
    if (lat != null && row.lat == null) patch.lat = lat;
    if (lng != null && row.lng == null) patch.lng = lng;
    if (county && !row.county) patch.county = county;
    if (city && !row.city) patch.city = city;
    if (zip && !row.zip) patch.zip = zip;
    if (parcelId && !row.parcel_id) patch.parcel_id = parcelId;
    if (ownerName && !row.owner_name) patch.owner_name = ownerName;
    if (Object.keys(patch).length) {
      patch.updated_at = new Date().toISOString();
      const updated = await supabasePatch(`properties?property_id=eq.${row.property_id}`, patch);
      if (updated.ok && updated.data?.length) return { ok: true, property: updated.data[0], created: false };
    }
    return { ok: true, property: row, created: false };
  }
  if (existing.notConfigured) return { ok: false, notConfigured: true, error: existing.error };

  const created = await supabasePost("properties", [{
    address, lat: lat ?? null, lng: lng ?? null, county: county ?? null,
    city: city ?? null, zip: zip ?? null, parcel_id: parcelId ?? null, owner_name: ownerName ?? null,
  }]);
  if (!created.ok) return { ok: false, error: created.error };
  return { ok: true, property: created.data?.[0], created: true };
}

export async function getProperty(propertyId) {
  const res = await supabaseGet(`properties?property_id=eq.${propertyId}&select=*&limit=1`);
  if (!res.ok) return res;
  return { ok: true, property: res.data?.[0] || null };
}

export async function listProperties({ county, limit = 50 } = {}) {
  let path = `properties?select=*&order=updated_at.desc&limit=${limit}`;
  if (county) path += `&county=eq.${encodeURIComponent(county)}`;
  return supabaseGet(path);
}

export async function updatePropertyScore(propertyId, score) {
  return supabasePatch(`properties?property_id=eq.${propertyId}`, {
    property_score: score,
    updated_at: new Date().toISOString(),
  });
}
