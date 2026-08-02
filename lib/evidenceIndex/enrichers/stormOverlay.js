// lib/evidenceIndex/enrichers/stormOverlay.js
//
// Real integration with the National Weather Service API
// (https://api.weather.gov) — free, keyless, matches the data source
// AeroLeadAI's own weather-agent already uses. Pulls active alerts for a
// lat/lon, extracts hail size / wind speed where the alert text actually
// states them (real regex against real NWS alert text, not invented), and
// flags heavy snow/rain from the alert's event type. Ported from
// evidence_index/ Python prototype's enrichers/storm_overlay.py, unchanged.
//
// NWS active alerts only cover CURRENT/recent weather, not deep historical
// hail swaths — for that you'd need NOAA's Storm Events Database (a bulk
// CSV/API dataset, different product, not wired here).

import { NWS_API_BASE, NWS_USER_AGENT } from "../config";

const HEADERS = { "User-Agent": NWS_USER_AGENT, Accept: "application/geo+json" };

const HAIL_SIZE_PATTERN = /(\d+(?:\.\d+)?)\s*(?:inch|in)\b.*?hail/i;
const WIND_SPEED_PATTERN = /(\d+)\s*mph/i;

/**
 * Real call to NWS active alerts for a point. Returns [] on any failure
 * rather than throwing — a storm overlay that can't reach the API should
 * degrade to "no storm evidence found", not crash the pipeline.
 */
export async function getActiveAlerts(lat, lon) {
  try {
    const params = new URLSearchParams({ point: `${lat},${lon}` });
    const res = await fetch(`${NWS_API_BASE}/alerts/active?${params.toString()}`, {
      headers: HEADERS,
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw new Error(`NWS API returned ${res.status}`);
    const json = await res.json();
    return json?.features || [];
  } catch (e) {
    console.warn(`[stormOverlay] NWS API call failed: ${e.message}`);
    return [];
  }
}

/**
 * Extracts hailInches / windMph / heavySnow / heavyRain from real alert
 * text. Only sets a value when the text actually supports it — never
 * defaults to a nonzero guess.
 */
export function parseStormSignals(alerts) {
  let hailInches = 0;
  let windMph = 0;
  let heavySnow = false;
  let heavyRain = false;

  for (const alert of alerts) {
    const props = alert?.properties || {};
    const event = (props.event || "").toLowerCase();
    const text = `${props.description || ""} ${props.headline || ""}`;

    const hailMatch = HAIL_SIZE_PATTERN.exec(text);
    if (hailMatch) hailInches = Math.max(hailInches, parseFloat(hailMatch[1]));

    const windMatch = WIND_SPEED_PATTERN.exec(text);
    if (windMatch) windMph = Math.max(windMph, parseInt(windMatch[1], 10));

    if (event.includes("snow") || event.includes("blizzard")) heavySnow = true;
    if (event.includes("flood") || event.includes("rain")) heavyRain = true;
  }

  return {
    hailInches,
    windMph,
    heavySnow,
    heavyRain,
    stormConfidence: alerts.length ? 90 : 0, // real alerts = high confidence in the storm signal; no alerts = no signal, not "no storm"
  };
}

/**
 * Expects lead.lat / lead.lon. If either is missing, returns the lead
 * unchanged (plus stormConfidence: 0) rather than guessing a location.
 */
export async function enrichStorm(lead) {
  const { lat, lon } = lead;
  if (lat == null || lon == null) return { ...lead, stormConfidence: 0 };

  const alerts = await getActiveAlerts(lat, lon);
  const signals = parseStormSignals(alerts);

  // Only fill in storm fields the lead doesn't already have from another
  // source (e.g. a more precise hail-swath dataset) — never overwrite
  // better data with a coarser real-time alert parse.
  const merged = { ...lead };
  for (const [key, value] of Object.entries(signals)) {
    if (merged[key] === undefined || merged[key] === null || merged[key] === 0 || merged[key] === false) {
      merged[key] = value;
    }
  }

  return merged;
}
