from typing import Dict, List, Tuple
from gatekeeper.engines.lexicon import DOMAIN_LEXICON, NEGATION_PATTERNS


def decompose_semantic(claim: str) -> Dict[str, object]:
    """
    Upgrade over decomposer.decompose(): weighted multi-phrase matching
    across a much larger domain lexicon (including Lucky AI Solutions'
    own project vocabulary), plus negation/qualifier detection so phrases
    like "not yet built" or "requires FAA approval" are surfaced as
    explicit gaps rather than silently ignored.

    Returns:
        existing_components: List[str]      (domains with any signal)
        missing_components:  List[str]      (unchanged semantics from v1)
        domain_confidence:   Dict[str,float] (0-1 strength per domain)
        negation_flags:      List[str]      (gap types detected)
    """
    text = claim.lower()
    domain_confidence: Dict[str, float] = {}

    for domain, phrases in DOMAIN_LEXICON.items():
        score = 0.0
        for phrase, weight in phrases:
            if phrase in text:
                score = max(score, weight)
        if score > 0:
            domain_confidence[domain] = round(score, 3)

    negation_flags: List[str] = sorted(
        {gap for phrase, gap in NEGATION_PATTERNS if phrase in text}
    )

    existing_components = sorted(domain_confidence.keys())
    missing_components: List[str] = []
    if not existing_components:
        missing_components.append("capability primitives not yet identified")

    return {
        "existing_components": existing_components,
        "missing_components": missing_components,
        "domain_confidence": domain_confidence,
        "negation_flags": negation_flags,
    }
