"""
engines/evidence_engine.py

evidence_score = maturity + hail + wind + snow + rain + tree + gutter + driveway

Ported from the original chapter_1/chapter_2 modules and extended with
the three ancillary-service flags per the requested formula shape.
Nothing here is randomized or guessed at runtime — every point value
traces back to a named constant in constants.py.
"""

from constants import (
    MATURITY_TIERS,
    PERMIT_RECENCY_YEARS,
    HAIL_INCHES_THRESHOLD,
    HAIL_POINTS,
    WIND_MPH_THRESHOLD,
    WIND_POINTS,
    SNOW_POINTS,
    RAIN_POINTS,
    TREE_RISK_POINTS,
    GUTTER_DAMAGE_POINTS,
    DRIVEWAY_CRACK_POINTS,
)


def maturity_level(age, permit_within_10y):
    """Returns (level, points). A recent permit zeroes out roof-age evidence
    entirely — a roof with a permit in the last PERMIT_RECENCY_YEARS was
    already addressed, regardless of its calendar age."""
    if permit_within_10y:
        return 0, 0
    for min_age, level, points in MATURITY_TIERS:
        if age >= min_age:
            return level, points
    return 0, 0


def evidence_score(lead: dict) -> int:
    score = 0

    _, maturity_points = maturity_level(
        lead.get("age", 0), lead.get("permit_within_10y", False)
    )
    score += maturity_points

    if lead.get("hail_inches", 0) >= HAIL_INCHES_THRESHOLD:
        score += HAIL_POINTS
    if lead.get("wind_mph", 0) >= WIND_MPH_THRESHOLD:
        score += WIND_POINTS
    if lead.get("heavy_snow", False):
        score += SNOW_POINTS
    if lead.get("heavy_rain", False):
        score += RAIN_POINTS

    # Ancillary service flags — each is independent of roof evidence and
    # additive, since a property can have tree risk AND roof damage AND
    # gutter damage simultaneously.
    if lead.get("tree_risk", False):
        score += TREE_RISK_POINTS
    if lead.get("gutter_damage", False):
        score += GUTTER_DAMAGE_POINTS
    if lead.get("driveway_cracks", False):
        score += DRIVEWAY_CRACK_POINTS

    return score
