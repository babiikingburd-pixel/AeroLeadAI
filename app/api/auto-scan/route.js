// Autonomous background scanner — intended to be triggered by Vercel Cron
// (see vercel.json), not by users. Each run: pulls a small, bounded batch of
// pending ZIPs from the queue, scans each for addresses (OSM Overpass, same
// as the interactive /api/zip-scan), scores a capped number of them through
// the existing damage/permit pipeline, upserts results into `leads`, then
// discovers neighboring ZIPs (still within the target state) to grow the
// queue for future runs. "Slowly but surely" is enforced by the AUTO_SCAN_*
// caps below, not just good intentions — this hits paid/rate-limited APIs
// (vision models, imagery providers) on every address, so an unbounded run
// would be a real cost/rate-limit problem, not just a slow one.
//
// Requires Supabase (NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY) —
// there is nowhere else server-side to persist state between runs. Run
// supabase_autonomous_scan_schema.sql once before enabling this.
//
// Protect this route in production: set CRON_SECRET in Vercel env vars.
// Vercel Cron automatically sends `Authorization: Bearer $CRON_SECRET` on
// every scheduled invocation when that var is set — this route checks it and
// rejects anything else, so the endpoint can't be triggered (and billed) by
// a random request. If CRON_SECRET is unset, the check is skipped (fine for
// local testing, NOT recommended once this is live on a public deployment).

import { scanZipForAddresses, uspsValidateBatch, findNeighborZips, mapWithConcurrency } from "../../../lib/zipScan";
import { sbSelect, sbInsert, sbUpsert, sbUpdate, supabaseAdminConfig } from "../../../lib/supabaseServer";

export const maxDuration = 60; // Hobby-plan ceiling — keep AUTO_SCAN_* small enough to fit this.
export const dynamic = "force-dynamic"; // never statically cache a cron endpoint that must run fresh every invocation

function tierOf(permitWithin10y, damageScore) {
  if (permitWithin10y) return "low-priority";
  if (damageScore === null || damageScore === undefined) return "unscored";
  if (damageScore >= 75) return "hot";
  if (damageScore >= 50) return "warm";
  if (damageScore >= 25) return "cool";
  return "cold";
}

async function processAddress(origin, candidate, zip) {
  const { address, lat, lon, uspsVerified } = candidate;
  let permitWithin10y = false, permitNotes = "Not checked";
  try {
    const pr = await (await fetch(`${origin}/api/permit-lookup?address=${encodeURIComponent(address)}`)).json();
    if (pr.ok && pr.inDirectory) {
      permitWithin10y = !!pr.lowPriority;
      permitNotes = pr.lowPriority ? pr.lowPriorityReason : `${pr.records.length} record(s), none within 10 years`;
    } else {
      permitNotes = pr.notes || "Not in directory";
    }
  } catch (_) {}

  let damageScore = null, damageNotes = null;
  if (!permitWithin10y && lat && lon) {
    try {
      const img = await (await fetch(`${origin}/api/imagery-agent`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ lat, lon }) })).json();
      if (img.dataUrl) {
        const mediaType = img.dataUrl.slice(5, img.dataUrl.indexOf(";"));
        const dmg = await (await fetch(`${origin}/api/damage-agent`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ domain: "roof", images: [{ base64Image: img.dataUrl.split(",")[1], mediaType }], address }),
        })).json();
        if (!dmg.error) { damageScore = dmg.concern_score; damageNotes = dmg.notes || null; }
      }
    } catch (_) {}
  }

  return {
    address, zip, lat: lat || null, lon: lon || null,
    damage_score: damageScore, damage_notes: damageNotes,
    permit_within_10y: permitWithin10y, permit_notes: permitNotes,
    usps_verified: uspsVerified ?? null,
    tier: tierOf(permitWithin10y, damageScore),
    updated_at: new Date().toISOString(),
  };
}

export async function GET(req) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${cronSecret}`) {
      return Response.json({ ok: false, error: "Unauthorized." }, { status: 401 });
    }
  }

  if (!supabaseAdminConfig().configured) {
    return Response.json({ ok: false, error: "Supabase not configured — set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, and run supabase_autonomous_scan_schema.sql." }, { status: 200 });
  }

  const origin = new URL(req.url).origin;
  const seedZip = process.env.AUTO_SCAN_SEED_ZIP || "55407";
  const seedState = (process.env.AUTO_SCAN_SEED_STATE || "MN").toUpperCase();
  const zipsPerRun = Math.max(1, parseInt(process.env.AUTO_SCAN_ZIPS_PER_RUN, 10) || 1);
  const addressesPerZip = Math.max(1, Math.min(20, parseInt(process.env.AUTO_SCAN_ADDRESSES_PER_ZIP, 10) || 8));
  const neighborRadiusM = parseInt(process.env.AUTO_SCAN_NEIGHBOR_RADIUS_M, 10) || 9000;

  const summary = { ranAt: new Date().toISOString(), zipsProcessed: [], newLeadsFound: 0, neighborZipsQueued: 0, errors: [] };

  try {
    // Seed the queue on first-ever run.
    const existing = await sbSelect("zip_scan_queue", "select=zip&limit=1");
    if (existing.length === 0) {
      await sbInsert("zip_scan_queue", [{ zip: seedZip, state: seedState, status: "pending" }]);
    }

    const pending = await sbSelect("zip_scan_queue", `status=eq.pending&select=zip,state&order=created_at.asc&limit=${zipsPerRun}`);
    if (pending.length === 0) {
      return Response.json({ ...summary, note: "Queue empty — nothing pending. Widen AUTO_SCAN_NEIGHBOR_RADIUS_M or add ZIPs manually to zip_scan_queue if this state is fully covered." });
    }

    for (const { zip, state } of pending) {
      await sbUpdate("zip_scan_queue", `zip=eq.${zip}`, { status: "scanning" });

      try {
        const scan = await scanZipForAddresses(zip, addressesPerZip);
        if (!scan.ok) {
          await sbUpdate("zip_scan_queue", `zip=eq.${zip}`, { status: "failed", last_error: scan.error, scanned_at: new Date().toISOString() });
          summary.errors.push(`${zip}: ${scan.error}`);
          continue;
        }

        const { verified } = await uspsValidateBatch(scan.addresses, zip);
        const candidates = scan.addresses.map((c, i) => ({ ...c, address: verified[i] || c.address, uspsVerified: !!verified[i] }));

        // Concurrency 2: gentle on free-tier vision-model rate limits and
        // keeps a full run inside the maxDuration budget above.
        const leads = await mapWithConcurrency(candidates, 2, (c) => processAddress(origin, c, zip));
        await sbUpsert("leads", leads, "address_normalized");
        summary.newLeadsFound += leads.length;

        // Expand the queue: average the found coordinates as a search center,
        // look for nearby postcodes still in-state, queue any not seen before.
        const withCoords = candidates.filter((c) => c.lat && c.lon);
        if (withCoords.length) {
          const avgLat = withCoords.reduce((s, c) => s + Number(c.lat), 0) / withCoords.length;
          const avgLon = withCoords.reduce((s, c) => s + Number(c.lon), 0) / withCoords.length;
          const neighborZips = await findNeighborZips(avgLat, avgLon, neighborRadiusM, state || seedState);
          if (neighborZips.length) {
            const knownRows = await sbSelect("zip_scan_queue", `zip=in.(${neighborZips.join(",")})&select=zip`);
            const known = new Set(knownRows.map((r) => r.zip));
            const toQueue = neighborZips.filter((z) => !known.has(z) && z !== zip);
            if (toQueue.length) {
              await sbInsert("zip_scan_queue", toQueue.map((z) => ({ zip: z, state: state || seedState, status: "pending", discovered_from: zip })));
              summary.neighborZipsQueued += toQueue.length;
            }
          }
        }

        await sbUpdate("zip_scan_queue", `zip=eq.${zip}`, { status: "done", address_count: candidates.length, leads_found: leads.length, scanned_at: new Date().toISOString() });
        summary.zipsProcessed.push({ zip, addresses: candidates.length, leadsFound: leads.length });
      } catch (e) {
        await sbUpdate("zip_scan_queue", `zip=eq.${zip}`, { status: "failed", last_error: e.message, scanned_at: new Date().toISOString() });
        summary.errors.push(`${zip}: ${e.message}`);
      }
    }

    return Response.json({ ok: true, ...summary });
  } catch (e) {
    return Response.json({ ok: false, error: e.message, ...summary }, { status: 500 });
  }
}
