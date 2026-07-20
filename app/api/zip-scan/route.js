// Interactive ZIP-code address scan (server-side, avoids browser CORS).
// Pulls addressed buildings from OpenStreetMap's Overpass API — free, no key,
// no paid parcel vendor required. Real coverage depends on how well that ZIP
// is mapped in OSM; sparsely-mapped areas will legitimately return few/none
// (surfaced via `error`/`debug` rather than pretending success).
//
// Optional USPS deliverability check (set USPS_CLIENT_ID + USPS_CLIENT_SECRET,
// free registration at developer.usps.com): USPS has no public endpoint that
// *lists* every address in a ZIP — that's a paid CASS-licensed bulk product,
// not something a simple API key gets you — so this can't replace the OSM
// scan above. What it CAN do is confirm/standardize each OSM-found address
// against USPS's own database, which is worth having since OSM data is
// crowd-sourced and sometimes stale or wrong. Every address is returned
// either way; `uspsVerified` just tells you which ones USPS could confirm.
//
// Shared scan/validation logic lives in lib/zipScan.js — /api/auto-scan (the
// autonomous background scanner) uses the same functions.

import { scanZipForAddresses, uspsValidateBatch } from "../../../lib/zipScan";

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const zip = (searchParams.get("zip") || "").trim();
  const max = Math.min(parseInt(searchParams.get("max"), 10) || 50, 200);

  const scan = await scanZipForAddresses(zip, max);
  if (!scan.ok) return Response.json(scan);

  const debug = [];
  const { verified, note } = await uspsValidateBatch(scan.addresses, zip);
  if (note) debug.push(note);
  const addresses = scan.addresses.map((c, i) => ({
    address: verified[i] || c.address,
    lat: c.lat, lon: c.lon,
    uspsVerified: !!verified[i],
  }));

  return Response.json({ ok: true, zip, city: scan.city, state: scan.state, count: addresses.length, addresses, ...(debug.length ? { debug } : {}) });
}
