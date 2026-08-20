"""
Investigation models. New namespace (gatekeeper/investigation/) — separate
from the core gatekeeper/models.py, which stays untouched. Core Evidence
already has a fixed shape used throughout v1.1-v1.5; this module's
ProbeEvidence is intentionally a distinct class rather than reusing that
name, so nothing upstream silently breaks.
"""
from __future__ import annotations
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
import uuid


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


@dataclass
class CapabilityClaim:
    claim: str
    domain: str = "unknown"
    required_actions: List[str] = field(default_factory=list)
    constraints: List[str] = field(default_factory=list)
    risk: str = "low"
    id: str = field(default_factory=lambda: str(uuid.uuid4()))


@dataclass
class Probe:
    name: str
    purpose: str
    capability: str
    action: str
    args: Dict[str, Any] = field(default_factory=dict)
    risk: str = "low"
    timeout_s: float = 20.0
    retries: int = 2
    required: bool = True
    id: str = field(default_factory=lambda: str(uuid.uuid4()))


@dataclass
class ProbeEvidence:
    kind: str
    claim: str
    value: Any
    confidence: float = 0.5
    source: str = "unknown"
    observed_at: str = field(default_factory=utc_now)
    verified: bool = False
    metadata: Dict[str, Any] = field(default_factory=dict)
    id: str = field(default_factory=lambda: str(uuid.uuid4()))

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class ProbeResult:
    probe: Probe
    ok: bool
    output: Any = None
    error: Optional[str] = None
    transient: bool = False
    duration_s: float = 0.0
    evidence: List[ProbeEvidence] = field(default_factory=list)
    attempt: int = 1
    status: str = "unknown"

    def to_dict(self) -> Dict[str, Any]:
        d = asdict(self)
        return d


@dataclass
class InvestigationResult:
    investigation_id: str
    claim: str
    status: str
    score: float
    confidence: float
    reproducibility: float
    probes: List[ProbeResult]
    evidence: List[ProbeEvidence]
    contradictions: List[str]
    decision: str
    next_actions: List[str]
    created_at: str = field(default_factory=utc_now)

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)
