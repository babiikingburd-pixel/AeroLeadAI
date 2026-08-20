"""
LLM adapter layer.

The core engine (v1) is deliberately model-agnostic and local-only. This
module is the opt-in upgrade path: it lets an actual language model (Claude,
or any other) perform the CLASSIFY step with real semantic understanding
instead of keyword matching, while preserving the Gatekeeper's non-negotiable
rule: a model's *opinion* about a claim is evidence to be audited, never an
automatic promotion to REAL-NOW.

Design:
- LLMProvider is a minimal protocol: analyze(claim, evidence) -> dict | None
- NullProvider is the default — always returns None, meaning "no LLM opinion
  available." The orchestrator falls back to the local semantic engine.
- ClaudeAPIProvider calls api.anthropic.com directly if ANTHROPIC_API_KEY is
  set in the environment. If the key is missing, or the network/API call
  fails for any reason, it fails soft (returns None) rather than crashing
  the assessment — consistent with "the engine never pretends to have
  performed an external action it did not actually perform."
"""
from __future__ import annotations
import json
import os
import urllib.request
import urllib.error
from typing import Any, Dict, List, Optional, Protocol


class LLMProvider(Protocol):
    def analyze(self, claim: str, evidence: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
        ...


class NullProvider:
    """Default provider. Always defers to the local semantic engine."""

    def analyze(self, claim: str, evidence: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
        return None


_SYSTEM_PROMPT = """You are the GateKeeper reality-assessment layer for Lucky AI Solutions.
Classify the given claim into exactly one of:
REAL-NOW, BUILDABLE-NOW, INTEGRATION-LIMITED, SIMULATED, FUTURE-INFRASTRUCTURE, UNKNOWN.

Rules:
- REAL-NOW requires verified evidence of the capability actually working, not just plausibility.
- Never classify something REAL-NOW on plausibility alone.
- A simulation, mock, or prototype without a verified real-world result is SIMULATED, not REAL-NOW.
- If the claim depends on access/API/permission that is not confirmed available, use INTEGRATION-LIMITED.
- If the claim requires physical/institutional infrastructure that does not currently exist at the needed scale, use FUTURE-INFRASTRUCTURE.
- If there isn't enough information to decide, use UNKNOWN. Do not guess.

Respond with ONLY a JSON object, no prose, no markdown fences:
{"classification": "...", "barrier": "...", "confidence": 0.0-1.0, "rationale": ["...", "..."]}
"""


class ClaudeAPIProvider:
    """
    Optional live upgrade: routes the CLASSIFY step through the Claude API.

    Requires ANTHROPIC_API_KEY in the environment. This class performs a
    real HTTP call to api.anthropic.com — it does not simulate a response.
    If the key is absent or the call fails, analyze() returns None (soft
    fail) so the orchestrator can fall back to the local semantic engine
    and record in the rationale that no LLM opinion was available.
    """

    def __init__(self, model: str = "claude-sonnet-4-6", timeout: float = 20.0):
        self.model = model
        self.timeout = timeout
        self.api_key = os.environ.get("ANTHROPIC_API_KEY")

    def analyze(self, claim: str, evidence: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
        if not self.api_key:
            return None
        payload = {
            "model": self.model,
            "max_tokens": 500,
            "system": _SYSTEM_PROMPT,
            "messages": [
                {
                    "role": "user",
                    "content": f"Claim: {claim}\nEvidence: {json.dumps(evidence)}",
                }
            ],
        }
        req = urllib.request.Request(
            "https://api.anthropic.com/v1/messages",
            data=json.dumps(payload).encode("utf-8"),
            headers={
                "Content-Type": "application/json",
                "x-api-key": self.api_key,
                "anthropic-version": "2023-06-01",
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                data = json.loads(resp.read().decode("utf-8"))
            text_blocks = [b["text"] for b in data.get("content", []) if b.get("type") == "text"]
            raw = "".join(text_blocks).strip()
            raw = raw.removeprefix("```json").removeprefix("```").removesuffix("```").strip()
            parsed = json.loads(raw)
            parsed["_source"] = "claude-api-live"
            return parsed
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, KeyError, ValueError):
            return None


class ManualOpinionProvider:
    """
    No API key required, no network call made. Used when an AI agent is
    *already* the one running this engine (this chat, Claude Code, an MCP
    tool call, etc.) — the agent reasons about the claim directly and
    supplies its own conclusion as data, instead of the script making an
    HTTP round-trip back out to an API it has no credential for.

    This is the honest version of "use the key you're already using": there
    is no portable key to reuse, but there doesn't need to be one when the
    agent itself is the process invoking the engine — it can just pass in
    what it already concluded.
    """

    def __init__(self, opinion: Dict[str, Any]):
        opinion = dict(opinion)
        opinion.setdefault("_source", "inline-agent-reasoning")
        self._opinion = opinion

    def analyze(self, claim: str, evidence: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
        return self._opinion


def get_default_provider() -> LLMProvider:
    """Auto-select: live Claude if a key is configured, else NullProvider."""
    if os.environ.get("ANTHROPIC_API_KEY"):
        return ClaudeAPIProvider()
    return NullProvider()
