"""Probe generation and capability decomposition."""
from dataclasses import dataclass, asdict
from typing import Any, Dict, List
from .registry import get_capability

@dataclass
class PlannedProbe:
    name: str
    capability: str
    action: str
    purpose: str
    required: bool = True
    retries: int = 2
    args: Dict[str, Any] = None
    expected: str = ""

    def to_dict(self): return asdict(self)

def infer_capabilities(claim: str) -> List[str]:
    text = claim.lower()
    hits = []
    rules = {
        "web_research": ["web", "internet", "research", "search", "http", "online"],
        "browser": ["browser", "click", "navigate", "login", "form", "computer use"],
        "vision": ["image", "photo", "picture", "vision", "visual", "video"],
        "code_execution": ["code", "python", "execute", "program", "script", "calculate"],
        "database": ["database", "sql", "query", "table", "record"],
    }
    for name, words in rules.items():
        if any(w in text for w in words): hits.append(name)
    return hits or ["reasoning"]

def build_plan(claim: str) -> List[PlannedProbe]:
    plan = [PlannedProbe("claim_parse", "reasoning", "parse_claim", "Parse and normalize the claim.", args={"claim": claim})]
    for capability in infer_capabilities(claim):
        spec = get_capability(capability)
        for i, test in enumerate(spec.tests):
            if test == "timeout" and "timeout" not in claim.lower():
                continue
            plan.append(PlannedProbe(
                name=f"{capability}:{test}", capability=capability, action=test,
                purpose=f"Test {test} for {capability}.",
                required=(i == 0 or capability == "reasoning"),
                retries=2,
                args={"claim": claim},
                expected="observable, reproducible result"
            ))
    plan.append(PlannedProbe("failure_boundary", "reasoning", "failure_boundary", "Classify failure before calling it impossible.", required=False, args={"claim": claim}))
    return plan
