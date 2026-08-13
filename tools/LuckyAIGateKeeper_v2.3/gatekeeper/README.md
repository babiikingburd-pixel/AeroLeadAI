# GateKeeper Engine

This is the executable machinery added to the Lucky AI onboarding package.
It turns the GateKeeper philosophy into a deterministic local assessment loop:

`CLAIM → DECOMPOSE → EVIDENCE → CLASSIFY → EXPERIMENT → AUDIT → JOURNAL`

## Components

- `engines/decomposer.py` — identifies capability primitives.
- `engines/evidence.py` — normalizes and summarizes evidence.
- `engines/classifier.py` — assigns the six GateKeeper classifications.
- `engines/experiments.py` — generates a smallest-test plan and failure condition.
- `engines/auditor.py` — catches classification/evidence contradictions.
- `engines/journal.py` — append-only JSONL assessment journal.
- `engines/orchestrator.py` — runs the full loop.
- `cli.py` — command-line entry point.

This is intentionally **model-agnostic**. An LLM, web researcher, crawler,
vision system, or external tool can feed evidence into it later. The engine
itself does not pretend to have performed external actions it did not perform.

## Run

```bash
python -m gatekeeper "Can an AI autonomously research and complete a project?"
```

## Evidence

```bash
python -m gatekeeper "Can an AI verify a real property record?" --evidence evidence.json
```

Evidence objects use `claim`, `source`, `kind`, `confidence` (0-1), and
`verified`.

## V2 upgrade (additive — nothing above this line was changed)

```bash
python -m gatekeeper.cli_v2 "Can we automate permit lookups via the county API?"
```

V2 adds weighted semantic decomposition (including Lucky AI Solutions'
own project vocabulary), negation/qualifier phrase detection ("not yet",
"requires approval", "future infrastructure"), a learner that adjusts
confidence from journal history, an extended auditor, and an optional
**live** LLM classification step.

The LLM step is opt-in and honest about its own availability:

- No `ANTHROPIC_API_KEY` in the environment → `NullProvider` is used,
  `llm_opinion_used: false` in the output, and the engine falls back to
  the local semantic classifier. This is the default in most environments,
  including this sandbox.
- `ANTHROPIC_API_KEY` set → `ClaudeAPIProvider` makes a real HTTP call to
  `api.anthropic.com`. If that call fails for any reason, it fails soft
  (same as having no key) rather than fabricating a result.

Even when a live LLM opinion is used, a hard rule in
`semantic_classifier.py` downgrades a REAL-NOW opinion that has no
verified evidence behind it — an LLM saying something is real is treated
as evidence to audit, not as proof.

### The "driver" model — no API key required when an agent is already running it

GateKeeper is the vehicle: philosophy, decomposition rules, classification
scaffolding, and an audit trail. It has no intelligence of its own. When an
AI agent (Claude in this chat, Claude Code, an MCP tool call, any onboarded
model) is the one actually invoking the engine, that agent doesn't need to
call back out to an API with a key — it IS the reasoning layer already. It
just hands its own conclusion in directly:

```bash
python -m gatekeeper.cli_v2 "<claim>" --llm-opinion my_opinion.json
```

where `my_opinion.json` is the agent's own live analysis:
`{"classification": "...", "barrier": "...", "confidence": 0.0-1.0, "rationale": ["..."]}`

This is `ManualOpinionProvider` in `llm_adapter.py` — zero network calls,
zero credentials, and it still passes through the same audit rules as the
live-API path (a REAL-NOW opinion with no verified evidence still gets
downgraded). `ClaudeAPIProvider` remains available separately for
unattended/headless runs where no agent is present to supply an opinion
directly — that path genuinely does require `ANTHROPIC_API_KEY`, because
without an agent already in the loop, something has to make the call.

Every v2 result includes the full, unedited v1 result under `"v1"` — the
upgrade never hides or silently overrides the deterministic core.
