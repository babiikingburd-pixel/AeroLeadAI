"""
engines/opportunity_engine.py

opportunity = property_value + roof_estimate + county_multiplier + ancillary_services

Ported from chapter_4 (property_value*0.4 + roof_estimate*0.3) and
extended with county_multiplier and ancillary_services per the requested
formula shape, with two deliberate deviations — both flagged rather than
done silently:

1. county_multiplier is applied MULTIPLICATIVELY to the base estimate,
   not added as a raw line item. A "multiplier" that's literally summed
   alongside dollar amounts doesn't behave like a multiplier (a
   county_multiplier of 1.0 would add a flat $1 to every property
   regardless of size). See county_enricher.py for where the multiplier
   comes from (currently neutral 1.0 for all six counties, pending real
   outcome data).

2. This function returns BOTH the raw dollar opportunity AND a
   normalized 0-100 score. The original chapter_4 (dollar formula) and
   chapter_5 (0-100 review threshold) were inconsistent with each
   other — a real $320k home alone scores ~133,400 in the raw dollar
   formula, so a >=75 threshold would trigger review on every single
   real property, always. human_review.py uses the normalized score;
   the raw dollar figure is preserved for real display/export use.
"""

from constants import (
    PROPERTY_VALUE_WEIGHT,
    ROOF_ESTIMATE_WEIGHT,
    ANCILLARY_SERVICE_WEIGHT,
    OPPORTUNITY_NORMALIZATION_DIVISOR,
)


def opportunity_score(lead: dict, county_multiplier: float = 1.0) -> dict:
    base = (
        lead.get("property_value", 0) * PROPERTY_VALUE_WEIGHT
        + lead.get("roof_estimate", 0) * ROOF_ESTIMATE_WEIGHT
    )
    base *= county_multiplier

    ancillary_total = sum(lead.get("ancillary_service_estimates", {}).values())
    raw_dollars = base + ancillary_total * ANCILLARY_SERVICE_WEIGHT

    normalized = min(100, round(raw_dollars / OPPORTUNITY_NORMALIZATION_DIVISOR))

    return {
        "raw_dollars": int(round(raw_dollars)),
        "normalized": int(normalized),
    }
