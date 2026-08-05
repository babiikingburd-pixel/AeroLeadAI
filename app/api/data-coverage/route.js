import { supabaseServer } from "../../../lib/supabaseServer";

// Data coverage dashboard feed. Exists because a priority score computed
// from empty fields looks identical to one computed from rich evidence —
// this endpoint makes the difference visible. Every number here is a live
// count, not a cached or estimated figure.
export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = supabaseServer();
  if (!supabase) return Response.json({ ok: false, error: "Supabase not configured." }, { status: 500 });

  // FIX (verified against production, which was returning a 500 with
  // "o(...).not is not a function"): filters must be chained AFTER
  // .select(). supabase.from() returns a PostgrestQueryBuilder, which only
  // knows select/insert/update/delete — .not()/.gt()/.eq()/.gte() live on
  // the PostgrestFilterBuilder that .select() returns. Every filtered count
  // here was built the other way round, so all thirteen of them threw; the
  // unfiltered `total` was the only one that worked, and since they share
  // one Promise.all a single rejection took the whole endpoint down.
  const c = () => supabase.from("batch_leads").select("id", { count: "exact", head: true });

  try {
    const [
      total, geoValid, hasYear, hasValue, hasHail, hasWind, hasStormDate,
      permitChecked, scored, residential, commercial, score80, confirmed, rejected,
    ] = await Promise.all([
      c(),
      c().not("lat", "is", null).not("lon", "is", null),
      c().not("year_built", "is", null),
      c().gt("assessed_value", 0),
      c().not("hail_inches", "is", null),
      c().not("wind_mph", "is", null),
      c().not("storm_date", "is", null),
      c().not("permit_notes", "is", null),
      c().gt("priority_score", 0),
      c().eq("property_class", "likely_residential"),
      c().eq("property_class", "likely_commercial"),
      c().gte("priority_score", 80),
      c().eq("review_status", "approved"),
      c().eq("review_status", "rejected"),
    ]);

    const n = (r) => r.count ?? 0;
    const totalN = n(total);
    const pct = (v) => (totalN ? Math.round((v / totalN) * 1000) / 10 : 0);

    const coverage = {
      total: totalN,
      fields: [
        { key: "geographic", label: "Valid coordinates", count: n(geoValid), pct: pct(n(geoValid)) },
        { key: "year_built", label: "Year built", count: n(hasYear), pct: pct(n(hasYear)) },
        { key: "assessed_value", label: "Assessed value", count: n(hasValue), pct: pct(n(hasValue)) },
        { key: "hail", label: "Hail exposure", count: n(hasHail), pct: pct(n(hasHail)) },
        { key: "wind", label: "Wind exposure", count: n(hasWind), pct: pct(n(hasWind)) },
        { key: "storm_date", label: "Storm event date", count: n(hasStormDate), pct: pct(n(hasStormDate)) },
        { key: "permit", label: "Permit actually looked up", count: n(permitChecked), pct: pct(n(permitChecked)) },
      ],
      funnel: {
        discovered: totalN,
        geoValid: n(geoValid),
        residential: n(residential),
        commercialExcluded: n(commercial),
        scored: n(scored),
        highScore: n(score80),
        confirmed: n(confirmed),
        rejected: n(rejected),
      },
      warnings: [],
    };

    if (n(hasHail) === 0 && n(hasWind) === 0) {
      coverage.warnings.push("No storm data present. Priority scores currently reflect property age and value only — not storm exposure.");
    }
    if (n(permitChecked) === 0) {
      coverage.warnings.push("permit_within_10y has never been populated by a real lookup. Treat it as unverified, not as evidence of no recent roof work.");
    }

    return Response.json({ ok: true, ...coverage });
  } catch (e) {
    return Response.json({ ok: false, error: e.message }, { status: 500 });
  }
}
