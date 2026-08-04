"""
Direct Shovels.ai permit lookup -- ported field-for-field from the Next.js
app's app/api/permit-lookup/route.js (shovelsLookup function), not
reinvented. Same request shape, same response field mapping. If Shovels'
API ever changes, both places need updating -- that's an accepted, minimal
duplication (a single external API call, not scoring logic), not the kind
of drift risk a duplicated scoring model would be.

This is real, independent evidence gathering: it works even if the Vercel
deployment is completely down, because it never touches Vercel at all --
just Shovels' API directly.
"""

from __future__ import annotations

import os
import re
from datetime import datetime, timedelta, timezone

import requests

SHOVELS_BASE = "https://api.shovels.ai/v2"


def normalize_address(address: str) -> str:
    """Same normalization the permits table's generated column applies:
    lower(regexp_replace(address, '[^a-zA-Z0-9]', '', 'g')). Used only for
    comparison/logging here -- never written to the DB, because that column
    is GENERATED ALWAYS and Postgres rejects explicit values for it."""
    return re.sub(r"[^a-z0-9]", "", (address or "").lower())


def shovels_lookup(address: str, api_key: str | None = None) -> dict | None:
    key = api_key or os.environ.get("PERMIT_API_KEY")
    if not key:
        return None

    headers = {"X-API-Key": key, "accept": "application/json"}

    search_res = requests.get(f"{SHOVELS_BASE}/addresses/search", headers=headers, params={"q": address}, timeout=15)
    search_res.raise_for_status()
    search_data = search_res.json()
    items = search_data if isinstance(search_data, list) else search_data.get("items", [])
    match = items[0] if items else None
    if not match:
        return {"records": [], "source": "shovels"}

    geo_id = match.get("geo_id") or match.get("id") or match.get("address_id")
    if not geo_id:
        return {"records": [], "source": "shovels"}

    permits_res = requests.get(
        f"{SHOVELS_BASE}/permits/search", headers=headers,
        params={"geo_id": geo_id, "permit_tags": "roofing"}, timeout=15,
    )
    permits_res.raise_for_status()
    permits_data = permits_res.json()
    permit_items = permits_data if isinstance(permits_data, list) else permits_data.get("items", [])

    records = []
    for p in permit_items:
        permit_type = p.get("permit_type") or p.get("description") or "permit"
        records.append({
            "issue_date": p.get("file_date") or p.get("issue_date"),
            "permit_type": permit_type,
            "permit_number": p.get("permit_number") or p.get("id"),
            "status": p.get("status"),
            "roof_related": "roof" in permit_type.lower(),
            "source_url": p.get("jurisdiction_permit_url"),
        })
    return {"records": records, "source": "shovels"}


def directory_rows(address: str, city: str | None, county: str | None, records: list[dict]) -> list[dict]:
    """Shape permit records for insertion into the app's own `permits`
    directory -- the same cache app/api/permit-lookup/route.js reads from
    before it spends a Shovels call. Writing here is what makes the
    follow-up rescore free: the Next.js worker's lookup becomes a directory
    hit instead of a second billed API call for the same address.

    address_normalized is deliberately NOT included: it is a GENERATED
    ALWAYS column, and Postgres rejects an INSERT that supplies a value for
    it ("cannot insert a non-DEFAULT value into column"). Postgres fills it
    from `address` on its own.
    """
    return [{
        "address": address,
        "city": city,
        "county": county,
        "permit_type": r.get("permit_type"),
        "permit_number": r.get("permit_number"),
        "issue_date": r.get("issue_date"),
        "status": r.get("status"),
        "roof_related": r.get("roof_related"),
        "source_url": r.get("source_url"),
        "source": "shovels",
    } for r in records]


def summarize_permit_check(records: list[dict]) -> dict:
    """Same 10-year roof-permit business rule as the JS worker."""
    roof_permits = [r for r in records if r.get("roof_related")]
    ten_years_ago = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(days=365 * 10)

    recent = []
    for r in roof_permits:
        issue_date = r.get("issue_date")
        if not issue_date:
            continue
        try:
            parsed = datetime.fromisoformat(issue_date.replace("Z", "+00:00")).replace(tzinfo=None)
        except ValueError:
            continue
        if parsed >= ten_years_ago:
            recent.append(r)

    return {
        "total_records": len(records),
        "roof_permits": len(roof_permits),
        "roof_permits_within_10y": len(recent),
        "permit_within_10y": len(recent) > 0,
        "most_recent": recent[0]["issue_date"] if recent else (roof_permits[0]["issue_date"] if roof_permits else None),
    }
