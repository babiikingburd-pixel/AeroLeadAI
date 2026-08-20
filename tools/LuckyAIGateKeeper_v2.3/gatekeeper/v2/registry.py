"""Capability registry for GateKeeper 2.0.

The registry defines what must be demonstrated for a capability and keeps
capability existence separate from current runtime availability.
"""
from dataclasses import dataclass, field
from typing import Dict, List

@dataclass(frozen=True)
class CapabilitySpec:
    name: str
    required: List[str]
    tests: List[str]
    risk: str = "low"
    min_confidence: float = 0.80
    min_reproducibility: float = 0.67

REGISTRY: Dict[str, CapabilitySpec] = {
    "reasoning": CapabilitySpec("reasoning", ["input", "reasoning", "output"], ["parse", "solve", "verify"]),
    "web_research": CapabilitySpec("web_research", ["network", "retrieval", "source_validation"], ["retrieve", "freshness", "cross_check", "contradiction"]),
    "browser": CapabilitySpec("browser", ["browser_runtime", "navigation", "interaction", "state_observation"], ["navigate", "click", "form", "recover", "repeat"], risk="medium"),
    "vision": CapabilitySpec("vision", ["image_input", "vision_model", "grounding"], ["open", "describe", "localize", "compare"], risk="medium"),
    "code_execution": CapabilitySpec("code_execution", ["runtime", "execution", "stdout_stderr", "timeout"], ["execute", "error", "timeout", "repeat"], risk="medium"),
    "database": CapabilitySpec("database", ["connection", "query", "readback"], ["connect", "query", "mutate", "verify"], risk="medium"),
}

def get_capability(name: str) -> CapabilitySpec:
    return REGISTRY.get(name, CapabilitySpec(name, [], ["minimal_test"]))
