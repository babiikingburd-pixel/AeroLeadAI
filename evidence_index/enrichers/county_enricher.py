"""
enrichers/county_enricher.py

Looks up which of the six supported counties a lead belongs to and
attaches its multiplier. Matching logic is real (normalizes and checks
against the supported list); the multiplier VALUES themselves are
neutral placeholders (see config.py's docstring) until real closed-deal
data exists to learn them from — same principle as AeroLeadAI's JS
county_weights table.
"""

from config import SUPPORTED_COUNTIES, COUNTY_MULTIPLIERS


def normalize_county(name: str) -> str:
    return (name or "").strip().lower().replace(" county", "")


def enrich_county(lead: dict) -> dict:
    """
    Expects lead to have a 'county' field (or leaves it unenriched if
    missing/unsupported — never guesses a county for an address).
    Returns the lead dict with 'county_normalized' and 'county_multiplier' added.
    """
    raw = lead.get("county")
    normalized = normalize_county(raw)

    if normalized not in SUPPORTED_COUNTIES:
        return {
            **lead,
            "county_normalized": normalized or None,
            "county_multiplier": 1.0,
            "county_supported": False,
        }

    return {
        **lead,
        "county_normalized": normalized,
        "county_multiplier": COUNTY_MULTIPLIERS[normalized],
        "county_supported": True,
    }
