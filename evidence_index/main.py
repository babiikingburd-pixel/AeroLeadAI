"""
main.py

Wires together exactly the six modules scoped for this weekend:
county_enricher -> storm_overlay -> evidence_engine -> confidence_engine
-> opportunity_engine -> human_review.

Everything upstream (permit_enricher, property_value, imagery_enricher)
and downstream (scoring_engine, contractor_export, CRM/PDF exports,
per-county modules, database sync) is intentionally NOT built here —
per the brief, those wait until this scoring pipeline proves itself on
real leads. A lead dict fed into run_pipeline() is expected to already
carry whatever permit/property_value/imagery data those future modules
would provide (see the example at the bottom of this file for the
expected shape).
"""

from enrichers.county_enricher import enrich_county
from enrichers.storm_overlay import enrich_storm
from engines.evidence_engine import evidence_score
from engines.confidence_engine import confidence_score
from engines.opportunity_engine import opportunity_score
from engines.human_review import requires_review


def run_pipeline(lead: dict) -> dict:
    lead = enrich_county(lead)
    lead = enrich_storm(lead)

    evidence = evidence_score(lead)
    confidence = confidence_score(lead)
    opportunity = opportunity_score(lead, county_multiplier=lead.get("county_multiplier", 1.0))
    review = requires_review(evidence, confidence, opportunity["normalized"])

    return {
        "address": lead.get("address"),
        "county": lead.get("county_normalized"),
        "evidence_score": evidence,
        "confidence_score": confidence,
        "opportunity_raw_dollars": opportunity["raw_dollars"],
        "opportunity_normalized": opportunity["normalized"],
        "review_required": review["review_required"],
        "review_reasons": review["reasons"],
    }


if __name__ == "__main__":
    # Example lead — mirrors the fields permit_enricher/property_value/
    # imagery_enricher will eventually supply. lat/lon drives the real
    # NWS storm lookup; hail_inches/wind_mph would normally come from
    # that call unless a more precise upstream source already set them.
    example_lead = {
        "address": "4433 Main St",
        "county": "Hennepin",
        "lat": 44.9778,
        "lon": -93.2650,
        "age": 22,
        "permit_within_10y": False,
        "property_value": 320000,
        "roof_estimate": 18000,
        "permit_confidence": 70,
        "imagery_confidence": 65,
        "human_reviewed": False,
        "tree_risk": False,
        "gutter_damage": True,
        "driveway_cracks": False,
        "ancillary_service_estimates": {"gutter_replacement": 1200},
    }

    result = run_pipeline(example_lead)
    print("Evidence Index v2 (restructured) — pipeline result:")
    for k, v in result.items():
        print(f"  {k}: {v}")
