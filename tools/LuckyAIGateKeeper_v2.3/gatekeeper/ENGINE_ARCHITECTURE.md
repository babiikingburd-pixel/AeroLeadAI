# GateKeeper Engine Architecture

## Core loop

1. **Discover** — accept a claim/capability.
2. **Decompose** — reduce it to observable primitives.
3. **Collect evidence** — separate observations from assumptions.
4. **Classify** — REAL-NOW, BUILDABLE-NOW, INTEGRATION-LIMITED, SIMULATED,
   FUTURE-INFRASTRUCTURE, or UNKNOWN.
5. **Design experiment** — specify the smallest test, success condition, and
   falsification condition.
6. **Audit** — reject obvious contradictions between evidence and claims.
7. **Journal** — persist the assessment so future runs can compare results.
8. **Learn** — future versions can feed prior journal results back into routing.

## Guardrail

The engine never treats a simulation as proof of real-world completion.
External actions must be supplied as evidence from an actual tool or operator.

## Extension points

- web research adapter
- browser/computer-use adapter
- vision adapter
- code execution adapter
- database adapter
- human approval gate
- evidence provenance graph
- repeated-test/reproducibility engine
- model router
- Commander orchestration layer

## V2 upgrade layer (implemented — see engines/*_v2 and semantic_*)

The extension points above are now partially filled in:

- **model router** → `llm_adapter.py`'s `get_default_provider()` auto-selects
  a live Claude provider if `ANTHROPIC_API_KEY` is present, else a null
  provider. Swapping in a different model means writing a new class that
  implements `LLMProvider.analyze()` — no changes needed elsewhere.
- **Learn step (loop closed)** → `learner.py` reads the journal and nudges
  confidence based on prior similar assessments, including whether they
  passed audit.
- Decomposition is now weighted and phrase-based (`lexicon.py`,
  `semantic_decomposer.py`) instead of single-keyword, and understands
  Lucky AI Solutions' own project vocabulary (AeroLeadAI, Dial-A-Trade,
  The Commander) directly.
- Classification (`semantic_classifier.py`) blends: v1 keyword baseline →
  negation/qualifier phrases → weighted domain signal → optional live LLM
  opinion (highest precedence, but audited, never trusted blindly).
- Auditing (`auditor_v2.py`) extends the original two checks with three more
  contradiction patterns.

Still open (not built in v1.2): web research adapter, browser/computer-use
adapter, vision adapter, code execution adapter, database adapter, human
approval gate, evidence provenance graph, repeated-test/reproducibility
engine, full Commander orchestration integration.

## V4 upgrade — Investigation Engine (see VERSION.md v1.4 section for detail)

As of v1.4, built and independently tested (REAL-NOW):
- code execution adapter, database adapter, web research adapter
- vision adapter (metadata tier only — content description stays honestly
  unimplemented)
- human approval gate
- evidence provenance graph
- repeated-test/reproducibility engine
- `investigator.py` — the piece that actually distinguishes a transient
  tool/access failure from a true permanent capability limit, with retry
  and backoff
- `commander.py` — a package-scoped version of the full loop, not the
  cross-portfolio Commander product

Still open: browser/computer-use automation (interface exists, no runtime
bundled), full semantic vision content understanding (needs a real vision
model call plugged into `adapters/vision.py::describe_content`), and
integration with the actual cross-portfolio Commander project.
