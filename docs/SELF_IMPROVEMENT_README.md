# AeroLeadAI — Self-Improvement Layer

Four layers, exactly as specced: **Memory → Experiments → Ranking → Controlled Self-Modification.**
The AI never edits or deploys its own code — it stops at "queued for human review" every time.

## Setup

```bash
pip install -r requirements.txt
cp .env.example .env   # fill in DATABASE_URL (Supabase or any Postgres)
psql "$DATABASE_URL" -f db/schema.sql
uvicorn api.main:app --reload --port 8100
```

The orchestrator loop starts automatically on app startup and runs every 30 minutes.

## The one integration point you actually need to wire

`services/crawler_service.py` — `execute_strategy()` currently returns stubbed
numbers per strategy. Replace the stub branches with real calls into your
existing three-agent backend (lead scoring / vision / dispatch). Everything
else — memory, scoring, ranking, proposals — is already wired to whatever
that function returns, no other file needs to change.

## What's real vs. stub right now

| Component | Status |
|---|---|
| `learning_memory`, `experiments`, `strategy_rankings`, `improvement_proposals` tables | Real, ready to use |
| Memory service (save/query runs) | Real |
| Experiment engine (pick strategy, run, record) | Real logic, stub data source |
| Evaluator (composite scoring) | Real — tune the weights in `evaluator_service.WEIGHTS` |
| Ranking (weekly top/middle/bottom) | Real |
| Self-mod proposal → sandbox test → human review → deploy | Real pipeline, `sandbox/test_runner.py` is a stub that **always fails safe (0% pass)** until you wire it to a real test harness — this is intentional so nothing gets queued for review by accident |
| Crawler (actual pipeline execution) | **Stub — this is the one file to replace** |

## Guardrails baked in (don't remove these)

- `self_mod_service.approve()` / `.reject()` / `.mark_deployed()` are meant to be called only from an authenticated admin action — never from the orchestrator loop.
- Sandbox tests run against fixture/replay data, never live leads or client data.
- Bottom-20% strategies are deactivated (`is_active = FALSE`), never row-deleted — history stays for future proposals to reason from.
- `PASS_THRESHOLD = 0.95` in `self_mod_service.py` — a proposal below this never reaches `queued_for_review`.
