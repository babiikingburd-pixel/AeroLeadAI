from typing import Any, Dict, List, Optional
from gatekeeper.models import Classification, Barrier, Evidence
from gatekeeper.engines.classifier import classify as classify_v1

_NEGATION_TO_CLASSIFICATION = {
    "access_gap": (Classification.INTEGRATION_LIMITED, Barrier.API),
    "authorization_gap": (Classification.INTEGRATION_LIMITED, Barrier.API),
    "legal_gap": (Classification.INTEGRATION_LIMITED, Barrier.LEGAL),
    "build_gap": (Classification.BUILDABLE_NOW, Barrier.UNKNOWN),
    "speculative": (Classification.UNKNOWN, Barrier.UNKNOWN),
    "future_gap": (Classification.FUTURE_INFRASTRUCTURE, Barrier.SCIENTIFIC),
    "scientific_gap": (Classification.FUTURE_INFRASTRUCTURE, Barrier.SCIENTIFIC),
    "simulation_flag": (Classification.SIMULATED, Barrier.RELIABILITY),
    "temporal_gap": (Classification.BUILDABLE_NOW, Barrier.UNKNOWN),
    # A "please try again later" / "currently unable" message describes a
    # capability that normally works but is momentarily throttled, overloaded,
    # or down — not a missing capability. INTEGRATION-LIMITED / reliability,
    # not SIMULATED and not FUTURE-INFRASTRUCTURE.
    "availability_gap": (Classification.INTEGRATION_LIMITED, Barrier.RELIABILITY),
}

# Precedence when multiple negation flags fire in one claim (most binding first)
_NEGATION_PRECEDENCE = [
    "scientific_gap", "future_gap", "simulation_flag",
    "legal_gap", "authorization_gap", "access_gap", "availability_gap",
    "build_gap", "temporal_gap", "speculative",
]


def classify_semantic(
    claim: str,
    evidence: List[Evidence],
    existing: List[str],
    missing: List[str],
    domain_confidence: Dict[str, float],
    negation_flags: List[str],
    llm_opinion: Optional[Dict[str, Any]] = None,
):
    """
    Returns (classification, barrier, confidence, rationale: List[str], source: str)

    Precedence, most to least authoritative:
    1. Verified evidence contradictions (handled downstream by auditor_v2)
    2. A live LLM opinion, when one was actually returned (never fabricated)
    3. Negation/qualifier phrases detected in the claim text
    4. Weighted semantic domain signals
    5. v1 keyword classifier, as a final deterministic floor
    """
    rationale: List[str] = []

    # Baseline: always compute the v1 result so it is never silently discarded.
    v1_class, v1_barrier, v1_conf = classify_v1(evidence, existing, missing, claim)
    rationale.append(f"v1 keyword baseline: {v1_class.value} (barrier: {v1_barrier.value}).")

    # If a live LLM opinion is present, treat it as the strongest signal but
    # still require it to be consistent with hard evidence rules.
    if llm_opinion and llm_opinion.get("classification") in {c.value for c in Classification}:
        try:
            c = Classification(llm_opinion["classification"])
            b = Barrier(llm_opinion.get("barrier", Barrier.UNKNOWN.value))
        except ValueError:
            c, b = v1_class, v1_barrier
        conf = float(llm_opinion.get("confidence", 0.6))
        rationale.append(
            f"LLM opinion ({llm_opinion.get('_source', 'unspecified')}) returned "
            f"{c.value} with stated confidence {conf}."
        )
        verified = [e for e in evidence if e.verified and e.confidence >= .8]
        if c == Classification.REAL_NOW and not verified:
            rationale.append(
                "Downgrading LLM's REAL-NOW opinion: no verified evidence present. "
                "Gatekeeper rule — plausibility is never sufficient for REAL-NOW."
            )
            c = Classification.BUILDABLE_NOW if existing else Classification.UNKNOWN
        return c, b, round(min(1.0, max(v1_conf, conf)), 3), rationale, "llm+audit"

    rationale.append("No LLM opinion available — falling back to local semantic engine.")

    # Negation/qualifier phrases override plain keyword hits when present.
    if negation_flags:
        for gap in _NEGATION_PRECEDENCE:
            if gap in negation_flags:
                c, b = _NEGATION_TO_CLASSIFICATION[gap]
                rationale.append(f"Negation/qualifier phrase detected ({gap}) -> {c.value}.")
                conf = round(min(1.0, .4 + .1 * len(evidence) + .2 * max(domain_confidence.values(), default=0)), 3)
                return c, b, conf, rationale, "semantic-negation"

    # Weighted domain-confidence path: use the strongest matched domain to
    # decide between BUILDABLE-NOW and INTEGRATION-LIMITED more precisely
    # than v1's flat existing/missing check.
    if domain_confidence:
        top_domain = max(domain_confidence, key=domain_confidence.get)
        top_score = domain_confidence[top_domain]
        rationale.append(f"Strongest semantic domain signal: '{top_domain}' ({top_score}).")
        if top_domain in {"api", "identity", "legal"} and top_score >= .6:
            c, b = Classification.INTEGRATION_LIMITED, Barrier.API if top_domain != "legal" else Barrier.LEGAL
        else:
            c, b = v1_class, v1_barrier
        conf = round(min(1.0, .3 + .2 * top_score + .1 * len(evidence)), 3)
        return c, b, conf, rationale, "semantic-domain"

    rationale.append("No domain signal or negation flag found — deferring to v1 baseline.")
    return v1_class, v1_barrier, v1_conf, rationale, "v1-fallback"
