"""
Investigation planner.

v1.4's investigator.investigate() required the caller to already know which
adapter/probe applies to a claim. This is the missing piece: given a raw
claim string, decompose it into domain + constraints + an ordered plan of
probes to actually run, without a human pre-selecting the test.
"""
from __future__ import annotations
import re
from typing import List
from gatekeeper.investigation.models import CapabilityClaim, Probe

DOMAIN_KEYWORDS = {
    # Order matters: more specific domains are checked first so a claim
    # mentioning both "browser" and "website" routes to the more specific
    # one instead of always falling into "web".
    "browser": ["browser", "click", "login", "form", "navigate", "website interaction"],
    "vision": ["image", "photo", "picture", "vision", "video", "visual"],
    "code": ["code", "python", "javascript", "execute", "program", "calculate"],
    "database": ["database", "sql", "record", "query", "table"],
    "web": ["web", "internet", "website", "http", "research", "search"],
}


class InvestigationPlanner:
    DOMAIN_KEYWORDS = DOMAIN_KEYWORDS

    def parse_claim(self, text: str) -> CapabilityClaim:
        text = text.strip()
        lower = text.lower()

        domain = "reasoning"
        for candidate, keywords in self.DOMAIN_KEYWORDS.items():
            if any(k in lower for k in keywords):
                domain = candidate
                break

        constraints = []
        for phrase, tag in [
            ("without", "without"), ("real-time", "real-time"),
            ("autonomous", "autonomous"), ("repeatedly", "repeatability"),
        ]:
            if phrase in lower:
                constraints.append(tag)

        return CapabilityClaim(
            claim=text, domain=domain,
            required_actions=self._extract_actions(text),
            constraints=constraints,
        )

    def _extract_actions(self, claim: str) -> List[str]:
        actions: List[str] = []
        for pattern in [r"\b(can|could|able to)\s+([a-zA-Z0-9_-]+)", r"\b(to)\s+([a-zA-Z0-9_-]+)"]:
            for match in re.findall(pattern, claim, flags=re.I):
                action = match[-1].lower()
                if action not in actions:
                    actions.append(action)
        return actions

    def plan(self, claim_text: str) -> List[Probe]:
        claim = self.parse_claim(claim_text)
        probes: List[Probe] = [
            Probe(
                name="claim_parse", purpose="Determine exactly what capability is being claimed.",
                capability="reasoning", action="parse_claim", args={"claim": claim.claim},
            ),
            Probe(
                name="minimal_execution", purpose="Attempt the smallest safe demonstration.",
                capability="execution", action="minimal_test", args={"claim": claim.claim},
            ),
        ]

        domain_probe_map = {
            "web": ("live_web", "web", "http_probe", 3),
            "browser": ("browser_runtime", "browser", "capability_probe", 1),
            "vision": ("vision_runtime", "vision", "capability_probe", 1),
            "code": ("code_runtime", "code", "capability_probe", 1),
            "database": ("database_runtime", "database", "capability_probe", 1),
        }
        if claim.domain in domain_probe_map:
            name, capability, action, retries = domain_probe_map[claim.domain]
            probes.append(Probe(
                name=name,
                purpose=f"Determine whether operational {capability} machinery is available.",
                capability=capability, action=action, args={"claim": claim.claim},
                retries=retries,
            ))

        probes.append(Probe(
            name="repeatability", purpose="Determine whether successful behavior can be reproduced.",
            capability="execution", action="repeat_test", args={"claim": claim.claim}, retries=1,
        ))
        probes.append(Probe(
            name="failure_boundary",
            purpose="Determine whether failure is temporary, environmental, authorization-related, or structural.",
            capability="diagnostics", action="failure_boundary", args={"claim": claim.claim},
        ))
        return probes
