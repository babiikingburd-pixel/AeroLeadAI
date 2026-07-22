// This route exists specifically to fix the Snow Load Supervisor bug from the
// artifact version: browser-side fetches to api.weather.gov were being
// blocked by the Claude artifact sandbox (it only allows calls to
// api.anthropic.com). Server-to-server has no such restriction.
//
// Also pulls NWS active alerts and forecast temperature swings so the Snow
// Load Supervisor can distinguish two different failure modes instead of
// lumping them into one "does it mention snow" flag:
//   - Roof structural load: raw weight of accumulated snow on the deck.
//   - Gutter/ice-dam risk: driven by freeze-thaw cycling (melt during the
//     day, refreeze overnight backs water up under shingles at the eave),
//     which is a DIFFERENT physical process from total snowfall and can be
//     the higher-risk one even in a light-snow winter.

const WINTER_HAZARD_PATTERN = /winter storm|ice storm|freezing rain|blizzard|winter weather advisory|frost|freeze warning/i;

export async function POST(req) {
  try {
    const { lat, lon } = await req.json();
    if (!lat || !lon) {
      return Response.json({ ok: false, summary: "No coordinates provided.", snowPeriods: 0, zone: null, activeWinterAlerts: [], freezeThawSignal: false });
    }

    const headers = { Accept: "application/geo+json", "User-Agent": "AeroLeadAI Property Intelligence (contact: set-your-email@example.com)" };

    const pointRes = await fetch(`https://api.weather.gov/points/${lat},${lon}`, { headers });
    if (!pointRes.ok) throw new Error(`NWS point lookup failed: ${pointRes.status}`);
    const point = await pointRes.json();
    const forecastUrl = point?.properties?.forecast;
    if (!forecastUrl) throw new Error("No forecast URL returned for these coordinates");

    const fRes = await fetch(forecastUrl, { headers });
    if (!fRes.ok) throw new Error(`NWS forecast fetch failed: ${fRes.status}`);
    const forecast = await fRes.json();
    const periods = forecast?.properties?.periods || [];
    const snowPeriods = periods.filter((p) => /snow/i.test(p.shortForecast || "") || /snow/i.test(p.detailedForecast || ""));

    // Freeze-thaw signal: any day period forecast above freezing followed or
    // preceded by a night period at/below freezing within the same window.
    // This is the actual ice-dam driver, independent of total snowfall.
    let freezeThawSignal = false;
    for (let i = 0; i < periods.length - 1; i++) {
      const a = periods[i], b = periods[i + 1];
      if (typeof a?.temperature === "number" && typeof b?.temperature === "number") {
        if ((a.temperature > 32 && b.temperature <= 32) || (a.temperature <= 32 && b.temperature > 32)) {
          freezeThawSignal = true;
          break;
        }
      }
    }

    // Active alerts at this point — real-time, not forecast. This is the
    // strongest, most current signal available and mirrors the same
    // storm-trigger pattern already used elsewhere in the pipeline.
    let activeWinterAlerts = [];
    try {
      const alertRes = await fetch(`https://api.weather.gov/alerts/active?point=${lat},${lon}`, { headers });
      if (alertRes.ok) {
        const alertData = await alertRes.json();
        const features = alertData?.features || [];
        activeWinterAlerts = features
          .filter((f) => WINTER_HAZARD_PATTERN.test(f?.properties?.event || ""))
          .map((f) => f.properties.event);
      }
    } catch { /* alerts are a bonus signal — forecast summary still stands without it */ }

    const summary = snowPeriods.length
      ? snowPeriods.map((p) => `${p.name}: ${p.shortForecast}`).join(" · ")
      : "No snow mentioned in the current 7-day NWS forecast.";

    return Response.json({
      ok: true,
      summary,
      snowPeriods: snowPeriods.length,
      zone: point?.properties?.forecastZone?.split("/").pop() || null,
      activeWinterAlerts,
      freezeThawSignal,
    });
  } catch (e) {
    return Response.json({ ok: false, summary: "Weather lookup failed: " + (e?.message || "unknown error"), snowPeriods: 0, zone: null, activeWinterAlerts: [], freezeThawSignal: false });
  }
}
