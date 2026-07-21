// US Census Bureau geography lookup — given a point, returns the county and
// state it falls in. Free, keyless, authoritative for US jurisdictions.
// Note this is NOT a street-address reverse geocoder (Census doesn't offer
// point-to-address matching) — it only returns the geographic areas
// (state/county/etc.) containing the point, which is exactly what's needed
// to route a parcel-boundary lookup to the right county GIS source.
export async function getCountyForPoint(lat, lon) {
  try {
    const res = await fetch(`https://geocoding.geo.census.gov/geocoder/geographies/coordinates?x=${lon}&y=${lat}&benchmark=Public_AR_Current&vintage=Current_Current&format=json`);
    if (!res.ok) return null;
    const data = await res.json();
    const county = data?.result?.geographies?.Counties?.[0];
    const state = data?.result?.geographies?.States?.[0];
    if (!county) return null;
    return { name: county.BASENAME, state: state?.STUSAB || null };
  } catch {
    return null;
  }
}
