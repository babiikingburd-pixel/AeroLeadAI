from gatekeeper.models import Experiment

def smallest_experiment(claim: str, missing: list[str], barrier: str) -> Experiment:
    deps = missing or [barrier]
    return Experiment(
        hypothesis=claim,
        smallest_test=f"Test the smallest independently observable component of: {claim}",
        success_condition="The claimed capability works against a real input with an observable output.",
        failure_condition="The test cannot complete, depends on an unavailable capability, or produces an unverifiable result.",
        dependencies=deps,
    )
