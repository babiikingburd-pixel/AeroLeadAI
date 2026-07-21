// This route exists specifically to fix the Snow Load Supervisor bug from the
// artifact version: browser-side fetches to api.weather.gov were being
// blocked by the Claude artifact sandbox (it only allows calls to
// api.anthropic.com). Server-to-server has no such restriction.

export async function POST(req) {
  try {
    const { lat, lon } = await req.json();
    if (!lat || !lon) {
      return Response.json({ ok: false, summary: "No coordinates provided.", snowPeriods: 0, zone: null });
    }

    const pointRes = await fetch(`https://api.weather.gov/points/${lat},${lon}`, {
      headers: { Accept: "application/geo+json", "User-Agent": "AeroLeadAI Property Intelligence (contact: set-your-email@example.com)" },
    });
    if (!pointRes.ok) throw new Error(`NWS point lookup failed: ${pointRes.status}`);
    const point = await pointRes.json();
    const forecastUrl = point?.properties?.forecast;
    if (!forecastUrl) throw new Error("No forecast URL returned for these coordinates");

    const fRes = await fetch(forecastUrl, { headers: { Accept: "application/geo+json", "User-Agent": "AeroLeadAI Property Intelligence (contact: set-your-email@example.com)" } });
    if (!fRes.ok) throw new Error(`NWS forecast fetch failed: ${fRes.status}`);
    const forecast = await fRes.json();
    const periods = forecast?.properties?.periods || [];
    const snowPeriods = periods.filter((p) => /snow/i.test(p.shortForecast || "") || /snow/i.test(p.detailedForecast || ""));

    const summary = snowPeriods.length
      ? snowPeriods.map((p) => `${p.name}: ${p.shortForecast}`).join(" · ")
      : "No snow mentioned in the current 7-day NWS forecast.";

    return Response.json({
      ok: true,
      summary,
      snowPeriods: snowPeriods.length,
      zone: point?.properties?.forecastZone?.split("/").pop() || null,
    });
  } catch (e) {
    return Response.json({ ok: false, summary: "Weather lookup failed: " + (e?.message || "unknown error"), snowPeriods: 0, zone: null });
  }
}
