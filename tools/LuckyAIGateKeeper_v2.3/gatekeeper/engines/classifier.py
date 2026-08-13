from typing import Iterable, List
from gatekeeper.models import Classification, Barrier, Evidence


def classify(evidence: Iterable[Evidence], existing: List[str], missing: List[str], claim: str):
    ev = list(evidence)
    verified = [e for e in ev if e.verified and e.confidence >= .8]
    simulation = any(e.kind.lower() in {"simulation", "prototype", "mock"} for e in ev)
    integration = any(k in claim.lower() for k in ["api", "permission", "access", "integration"])
    future = any(k in claim.lower() for k in ["not yet invented", "requires new science", "future infrastructure"])

    if future:
        c = Classification.FUTURE_INFRASTRUCTURE
        b = Barrier.SCIENTIFIC
    elif verified:
        c = Classification.REAL_NOW
        b = Barrier.UNKNOWN
    elif simulation and not verified:
        c = Classification.SIMULATED
        b = Barrier.RELIABILITY
    elif integration:
        c = Classification.INTEGRATION_LIMITED
        b = Barrier.API
    elif existing and not missing:
        c = Classification.BUILDABLE_NOW
        b = Barrier.UNKNOWN
    else:
        c = Classification.UNKNOWN
        b = Barrier.UNKNOWN

    confidence = min(1.0, .35 + .15 * len(ev) + .25 * len(verified))
    return c, b, round(confidence, 3)
