from typing import Any, Dict, List, Optional
from gatekeeper.models import Evidence
from gatekeeper.engines.orchestrator import GateKeeperEngine
from gatekeeper.engines.evidence import normalize
from gatekeeper.engines.semantic_decomposer import decompose_semantic
from gatekeeper.engines.semantic_classifier import classify_semantic
from gatekeeper.engines.auditor_v2 import audit_v2
from gatekeeper.engines.learner import learn_adjustment
from gatekeeper.engines.llm_adapter import LLMProvider, NullProvider, get_default_provider
from gatekeeper.engines.journal import append


class GateKeeperEngineV2:
    """
    Upgrade layer. The v1 GateKeeperEngine is used internally, unmodified,
    so every guarantee of the original core (deterministic, model-agnostic,
    never silently promotes simulation to reality) still holds as a floor.

    On top of that floor, v2 adds:
      - weighted, phrase-and-negation-aware semantic decomposition
      - an optional live LLM opinion (Claude, if ANTHROPIC_API_KEY is set;
        otherwise this step is skipped, never faked)
      - a learner that nudges confidence using journal history
      - an extended auditor with additional contradiction checks

    The v1 assessment is always computed and always included, unedited, in
    the result under "v1". The v2 layer is additive and clearly labeled
    under "v2" — nothing about the core is hidden or overridden silently.
    """

    def __init__(self, llm_provider: Optional[LLMProvider] = None, journal_path: str = "gatekeeper/data/journal.jsonl"):
        self.llm_provider = llm_provider if llm_provider is not None else get_default_provider()
        self.journal_path = journal_path
        self._v1_engine = GateKeeperEngine()

    def assess(self, claim: str, evidence: Optional[List[Evidence]] = None, persist: bool = True) -> Dict[str, Any]:
        evidence = normalize(evidence or [])
        evidence_dicts = [e.to_dict() if hasattr(e, "to_dict") else e.__dict__ for e in evidence]

        # 1. v1 floor — untouched core, always runs, never persisted twice
        #    (we persist only the combined v2 record to keep the journal
        #    coherent; set persist=False here and log the full picture below).
        v1_assessment = self._v1_engine.assess(claim, evidence, persist=False)

        # 2. Semantic decomposition (v2)
        sem = decompose_semantic(claim)

        # 3. Optional live LLM opinion — never fabricated; None if unavailable
        llm_opinion = None
        using_llm = not isinstance(self.llm_provider, NullProvider)
        if using_llm:
            llm_opinion = self.llm_provider.analyze(claim, evidence_dicts)

        # 4. Blended semantic classification
        c, b, conf, rationale, source = classify_semantic(
            claim, evidence,
            sem["existing_components"], sem["missing_components"],
            sem["domain_confidence"], sem["negation_flags"],
            llm_opinion=llm_opinion,
        )

        # 5. Learner nudge from journal history
        learn = learn_adjustment(sem["existing_components"], path=self.journal_path)
        final_confidence = round(max(0.0, min(1.0, conf + learn["confidence_delta"])), 3)

        v2_payload = {
            "classification": c.value,
            "barrier": b.value,
            "confidence": final_confidence,
            "rationale": rationale + [learn["note"]],
            "source": source,
            "domain_confidence": sem["domain_confidence"],
            "negation_flags": sem["negation_flags"],
            "llm_opinion_used": bool(llm_opinion),
            "llm_provider": type(self.llm_provider).__name__,
        }

        # 6. Extended audit — runs against the v2 conclusion
        audit_input = {
            "classification": v2_payload["classification"],
            "confidence": v2_payload["confidence"],
            "existing_components": sem["existing_components"],
            "evidence": evidence_dicts,
        }
        audit_result = audit_v2(audit_input, negation_flags=sem["negation_flags"])

        record = {
            "type": "assessment_v2",
            "claim": claim,
            "v1": v1_assessment.to_dict(),
            "v2": v2_payload,
            "audit_v2": audit_result,
        }
        if persist:
            append(record, path=self.journal_path)

        return record
