// Backs onto the same `permits` table described in supabase_permits_schema.sql
// (shipped at the project root). Uses SUPABASE_SERVICE_ROLE_KEY when present
// (server-side, not exposed to the browser) and falls back to the public
// NEXT_PUBLIC_SUPABASE_ANON_KEY if that's all that's configured — works either
// way as long as the RLS policies from the schema file are in place.
//
// This does NOT replace a real county-permit connector — it's the "your own
// directory" pattern: every address you (or the app) ever look up gets saved
// here permanently, so the second time that address comes up it's an instant,
// free hit instead of a repeat manual entry.

function supabaseConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  return { url, key };
}

function normalize(address) {
  return (address || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

// Shovels.ai — self-serve API key at app.shovels.ai, no sales call. Used
// ONLY as a fallback when the address isn't already in your own directory,
// so this cost is incurred once per address ever, not once per lookup.
async function shovelsLookup(address) {
  const key = process.env.PERMIT_API_KEY;
  if (!key || (process.env.PERMIT_API_PROVIDER || "shovels").toLowerCase() !== "shovels") return null;

  const headers = { "X-API-Key": key, accept: "application/json" };
  const searchRes = await fetch(`https://api.shovels.ai/v2/addresses/search?q=${encodeURIComponent(address)}`, { headers });
  if (!searchRes.ok) throw new Error(`Shovels address search HTTP ${searchRes.status}`);
  const searchData = await searchRes.json();
  const match = Array.isArray(searchData) ? searchData[0] : searchData?.items?.[0];
  if (!match) return { records: [], source: "shovels" };

  const geoId = match.geo_id || match.id || match.address_id;
  if (!geoId) return { records: [], source: "shovels" };

  const permitsRes = await fetch(`https://api.shovels.ai/v2/permits/search?geo_id=${encodeURIComponent(geoId)}&permit_tags=roofing`, { headers });
  if (!permitsRes.ok) throw new Error(`Shovels permit search HTTP ${permitsRes.status}`);
  const permitsData = await permitsRes.json();
  const items = Array.isArray(permitsData) ? permitsData : permitsData?.items || [];
  return {
    records: items.map((p) => ({
      issue_date: p.file_date || p.issue_date || null,
      permit_type: p.permit_type || p.description || "permit",
      permit_number: p.permit_number || p.id || null,
      status: p.status || null,
      roof_related: /roof/i.test(p.permit_type || p.description || ""),
      source_url: p.jurisdiction_permit_url || null,
    })),
    source: "shovels",
  };
}

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const address = searchParams.get("address");
  const { url, key } = supabaseConfig();

  if (!address) return Response.json({ ok: false, notes: "No address provided." });

  const tenYearsAgo = new Date();
  tenYearsAgo.setFullYear(tenYearsAgo.getFullYear() - 10);

  let rows = [];
  let directoryConfigured = !!(url && key);

  if (directoryConfigured) {
    try {
      const norm = normalize(address);
      const endpoint = `${url.replace(/\/$/, "")}/rest/v1/permits?address_normalized=eq.${encodeURIComponent(norm)}&select=*&order=updated_at.desc&limit=5`;
      const res = await fetch(endpoint, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
      if (!res.ok) throw new Error(`Supabase returned HTTP ${res.status}`);
      rows = await res.json();
    } catch (e) {
      // FIX: this used to `return` here, so ANY directory failure hard-failed
      // the whole lookup and SKIPPED the Shovels.ai external fallback below,
      // even when PERMIT_API_KEY is configured. A directory failure should
      // mean "0 rows in the directory," not "give up" — fall through instead.
      //
      // (An earlier note here claimed the `permits` table does not exist.
      // It does — verified in the live schema, currently 0 rows. The
      // fall-through is still right; the stated reason was not.)
      rows = [];
      directoryConfigured = false; // so notes below correctly say "not configured" rather than falsely implying it worked
    }
  }

  if (rows.length === 0) {
    // Not in your own directory (or directory isn't set up) — try the paid
    // external fallback (Shovels.ai) if a key is configured. This is opt-in:
    // with no PERMIT_API_KEY set, behavior is unchanged from before.
    try {
      const external = await shovelsLookup(address);
      if (external?.records?.length) {
        rows = external.records;
        // Auto-save into the own directory so the next lookup for this
        // address is free and instant, no repeat external API cost.
        if (directoryConfigured) {
          try {
            const endpoint = `${url.replace(/\/$/, "")}/rest/v1/permits`;
            const cacheRes = await fetch(endpoint, {
              method: "POST",
              headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", Prefer: "return=minimal" },
              // FIX (verified against the live database with a direct
              // insert test): address_normalized is a GENERATED ALWAYS
              // STORED column. Sending an explicit value for it made
              // Postgres reject the insert with "cannot insert a
              // non-DEFAULT value into column" -- every single time, since
              // the empty catch below swallowed the error silently. This is
              // why `permits` had 0 rows despite every Shovels lookup
              // "succeeding". Postgres computes this column itself from
              // `address` -- just don't send it.
              body: JSON.stringify(rows.map((r) => ({ address, ...r, source: "shovels" }))),
            });
            if (!cacheRes.ok) {
              // fetch() does NOT throw on HTTP error status codes -- only
              // on network failures. Without this check, even a fully
              // rejected insert (like the address_normalized bug above)
              // never reached the catch block at all. Both bugs had to be
              // fixed together for the cache-write to actually be visible
              // when it fails.
              throw new Error(`Supabase insert HTTP ${cacheRes.status}: ${(await cacheRes.text()).slice(0, 300)}`);
            }
          } catch (cacheErr) {
            // Best-effort cache — a save failure shouldn't block the
            // response to the user. But NOT silent: this exact class of
            // bug (address_normalized above) was invisible for as long as
            // it existed specifically because this catch used to discard
            // the error entirely. Log it so a schema mismatch shows up in
            // Vercel logs instead of hiding indefinitely.
            console.error("[permit-lookup] Shovels cache-write failed:", cacheErr.message);
          }
        }
      }
    } catch { /* external lookup is a bonus, not a requirement — fall through */ }
  }

  const recentPermit = rows.find((r) => r.issue_date && new Date(r.issue_date) >= tenYearsAgo);
  return Response.json({
    ok: true,
    inDirectory: rows.length > 0,
    // Whether the paid external fallback is even available. Without this,
    // "0 records" is ambiguous from the outside — no key configured and
    // key configured but genuinely no permits on file look identical, which
    // makes it impossible to tell a capability gap from a real negative
    // result. Boolean only; the key itself is never exposed.
    externalConfigured: !!process.env.PERMIT_API_KEY,
    records: rows,
    lowPriority: !!recentPermit,
    lowPriorityReason: recentPermit ? `Permit pulled ${recentPermit.issue_date} (within 10 years) — deprioritized.` : null,
    notes: rows.length
      ? `Found ${rows.length} record(s).`
      : directoryConfigured
        ? "Not in your directory yet — log it below and it'll be instant next time."
        : "Permit directory not configured — set NEXT_PUBLIC_SUPABASE_URL and a Supabase key to enable it. Log this one manually for now.",
  });
}

export async function POST(req) {
  const { url, key } = supabaseConfig();
  const body = await req.json();
  const { address, lat, lon, permitType, permitNumber, issueDate, status, roofRelated, notes, sourceUrl } = body || {};

  if (!address) return Response.json({ ok: false, notes: "Address required." }, { status: 400 });
  if (!url || !key) {
    return Response.json({ ok: false, notes: "Permit directory not configured — this entry stays local to this property only until Supabase is set up." });
  }

  try {
    const endpoint = `${url.replace(/\/$/, "")}/rest/v1/permits`;
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify([{
        address, lat: lat || null, lng: lon || null,
        permit_type: permitType || null, permit_number: permitNumber || null,
        issue_date: issueDate || null, status: status || null,
        roof_related: typeof roofRelated === "boolean" ? roofRelated : null,
        notes: notes || null, source_url: sourceUrl || null,
        source: "manual",
      }]),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`HTTP ${res.status} — ${text.slice(0, 200)}`);
    }
    return Response.json({ ok: true, notes: "Saved to your permit directory — instant lookup for this address from now on." });
  } catch (e) {
    return Response.json({ ok: false, notes: "Save to directory failed: " + e.message });
  }
}
