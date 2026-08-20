from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Dict, List, Optional
import uuid

class Classification(str, Enum):
    REAL_NOW = "REAL-NOW"
    BUILDABLE_NOW = "BUILDABLE-NOW"
    INTEGRATION_LIMITED = "INTEGRATION-LIMITED"
    SIMULATED = "SIMULATED"
    FUTURE_INFRASTRUCTURE = "FUTURE-INFRASTRUCTURE"
    UNKNOWN = "UNKNOWN"

class Barrier(str, Enum):
    KNOWLEDGE = "Knowledge limitation"
    COMPUTING = "Computing limitation"
    DATA = "Data limitation"
    API = "API/access limitation"
    HARDWARE = "Hardware limitation"
    PHYSICAL = "Physical-world limitation"
    RELIABILITY = "Reliability limitation"
    ECONOMIC = "Economic limitation"
    LEGAL = "Legal/regulatory limitation"
    ADOPTION = "Adoption/social limitation"
    SCIENTIFIC = "Scientific unknown"
    UNKNOWN = "Unknown / insufficient evidence"

@dataclass
class Evidence:
    claim: str
    source: str
    kind: str = "observation"
    confidence: float = 0.5
    verified: bool = False
    notes: str = ""
    timestamp: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    id: str = field(default_factory=lambda: str(uuid.uuid4()))

@dataclass
class Experiment:
    hypothesis: str
    smallest_test: str
    success_condition: str
    failure_condition: str
    dependencies: List[str] = field(default_factory=list)
    status: str = "proposed"
    result: Optional[str] = None
    id: str = field(default_factory=lambda: str(uuid.uuid4()))

@dataclass
class Assessment:
    claim: str
    classification: Classification
    barrier: Barrier
    confidence: float
    rationale: List[str]
    missing_components: List[str] = field(default_factory=list)
    existing_components: List[str] = field(default_factory=list)
    experiments: List[Experiment] = field(default_factory=list)
    evidence: List[Evidence] = field(default_factory=list)
    timestamp: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)
