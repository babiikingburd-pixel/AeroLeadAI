"""
tests/test_pipeline.py — real assertions against the six modules built
this weekend. Run with: pytest tests/ (from the evidence_index/ root)
"""
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from engines.evidence_engine import evidence_score, maturity_level
from engines.confidence_engine import confidence_score
from engines.opportunity_engine import opportunity_score
from engines.human_review import requires_review
from enrichers.county_enricher import enrich_county, normalize_county


def test_maturity_zeroed_by_recent_permit():
    level, points = maturity_level(age=30, permit_within_10y=True)
    assert (level, points) == (0, 0)


def test_maturity_tiers():
    assert maturity_level(26, False) == (3, 60)
    assert maturity_level(21, False) == (2, 50)
    assert maturity_level(16, False) == (1, 40)
    assert maturity_level(10, False) == (0, 0)


def test_evidence_score_combines_all_flags():
    lead = {
        "age": 26, "permit_within_10y": False,
        "hail_inches": 2.0, "wind_mph": 75,
        "heavy_snow": True, "heavy_rain": True,
        "tree_risk": True, "gutter_damage": True, "driveway_cracks": True,
    }
    # 60 (maturity) + 14 (hail) + 12 (wind) + 7 (snow) + 5 (rain) + 10 (tree) + 6 (gutter) + 5 (driveway)
    assert evidence_score(lead) == 119


def test_confidence_averages_present_signals_plus_review_boost():
    lead = {"permit_confidence": 80, "storm_confidence": 90, "imagery_confidence": 70, "human_reviewed": True}
    # avg(80,90,70) = 80, +20 boost = 100 (capped)
    assert confidence_score(lead) == 100


def test_confidence_handles_missing_signals():
    lead = {"permit_confidence": 60}
    assert confidence_score(lead) == 60


def test_opportunity_returns_raw_and_normalized():
    lead = {"property_value": 320000, "roof_estimate": 18000, "ancillary_service_estimates": {"gutter": 1200}}
    result = opportunity_score(lead, county_multiplier=1.0)
    assert result["raw_dollars"] == 134000
    assert 0 <= result["normalized"] <= 100


def test_opportunity_county_multiplier_scales_not_adds():
    lead = {"property_value": 100000, "roof_estimate": 0}
    result_1x = opportunity_score(lead, county_multiplier=1.0)
    result_2x = opportunity_score(lead, county_multiplier=2.0)
    assert result_2x["raw_dollars"] == result_1x["raw_dollars"] * 2


def test_human_review_triggers_on_each_condition_independently():
    assert requires_review(evidence=85, confidence=90, opportunity_normalized=10)["review_required"] is True
    assert requires_review(evidence=10, confidence=50, opportunity_normalized=10)["review_required"] is True
    assert requires_review(evidence=10, confidence=90, opportunity_normalized=80)["review_required"] is True
    assert requires_review(evidence=10, confidence=90, opportunity_normalized=10)["review_required"] is False


def test_county_enricher_normalizes_and_flags_unsupported():
    supported = enrich_county({"county": "Hennepin County"})
    assert supported["county_normalized"] == "hennepin"
    assert supported["county_supported"] is True

    unsupported = enrich_county({"county": "Ramsey Parish"})
    assert unsupported["county_supported"] is False
    assert unsupported["county_multiplier"] == 1.0


if __name__ == "__main__":
    import pytest
    raise SystemExit(pytest.main([__file__, "-v"]))
