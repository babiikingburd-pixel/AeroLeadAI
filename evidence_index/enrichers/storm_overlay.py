"""
enrichers/storm_overlay.py

Real integration with the National Weather Service API
(https://api.weather.gov) — free, keyless, matches the data source
AeroLeadAI's own weather-agent already uses. Pulls active alerts for a
lat/lon, extracts hail size / wind speed where the alert text actually
states them (real regex against real NWS alert text, not invented), and
flags heavy snow/rain from the alert's event type.

NWS active alerts only cover CURRENT/recent weather, not deep historical
hail swaths — for that you'd need NOAA's Storm Events Database (a bulk
CSV/API dataset, different product, not wired here). Flagged rather than
silently treated as equivalent.
"""

import re
import requests

from config import NWS_API_BASE, NWS_USER_AGENT

HEADERS = {"User-Agent": NWS_USER_AGENT, "Accept": "application/geo+json"}

HAIL_SIZE_PATTERN = re.compile(r"(\d+(?:\.\d+)?)\s*(?:inch|in)\b.*?hail", re.IGNORECASE)
WIND_SPEED_PATTERN = re.compile(r"(\d+)\s*mph", re.IGNORECASE)


def get_active_alerts(lat: float, lon: float) -> list[dict]:
    """Real call to NWS active alerts for a point. Returns [] on any
    failure rather than raising — a storm overlay that can't reach the
    API should degrade to 'no storm evidence found', not crash the pipeline."""
    try:
        resp = requests.get(
            f"{NWS_API_BASE}/alerts/active",
            params={"point": f"{lat},{lon}"},
            headers=HEADERS,
            timeout=10,
        )
        resp.raise_for_status()
        return resp.json().get("features", [])
    except requests.RequestException as e:
        print(f"[storm_overlay] NWS API call failed: {e}")
        return []


def parse_storm_signals(alerts: list[dict]) -> dict:
    """Extracts hail_inches / wind_mph / heavy_snow / heavy_rain from real
    alert text. Only sets a value when the text actually supports it —
    never defaults to a nonzero guess."""
    hail_inches = 0.0
    wind_mph = 0
    heavy_snow = False
    heavy_rain = False

    for alert in alerts:
        props = alert.get("properties", {})
        event = (props.get("event") or "").lower()
        description = props.get("description") or ""
        headline = props.get("headline") or ""
        text = f"{description} {headline}"

        hail_match = HAIL_SIZE_PATTERN.search(text)
        if hail_match:
            hail_inches = max(hail_inches, float(hail_match.group(1)))

        wind_match = WIND_SPEED_PATTERN.search(text)
        if wind_match:
            wind_mph = max(wind_mph, int(wind_match.group(1)))

        if "snow" in event or "blizzard" in event:
            heavy_snow = True
        if "flood" in event or "rain" in event:
            heavy_rain = True

    return {
        "hail_inches": hail_inches,
        "wind_mph": wind_mph,
        "heavy_snow": heavy_snow,
        "heavy_rain": heavy_rain,
        "storm_confidence": 90 if alerts else 0,  # real alerts = high confidence in the storm signal; no alerts = no signal, not "no storm"
    }


def enrich_storm(lead: dict) -> dict:
    """
    Expects lead to have 'lat' and 'lon'. If either is missing, returns
    the lead unchanged rather than guessing a location.
    """
    lat, lon = lead.get("lat"), lead.get("lon")
    if lat is None or lon is None:
        return {**lead, "storm_confidence": 0}

    alerts = get_active_alerts(lat, lon)
    signals = parse_storm_signals(alerts)

    # Only fill in storm fields the lead doesn't already have from another
    # source (e.g. a more precise hail-swath dataset) — never overwrite
    # better data with a coarser real-time alert parse.
    merged = {**lead}
    for key, value in signals.items():
        if key not in merged or merged[key] in (None, 0, False):
            merged[key] = value

    return merged
