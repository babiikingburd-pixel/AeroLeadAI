# AeroLeadAI Standalone Validator

A genuinely separate process from the Next.js/Vercel app. Runs on your
desktop (or any always-on machine), continuously — a real loop, which
Vercel's serverless functions cannot do.

## What it does, every cycle

1. **IMPORT** — pulls the current priority queue directly from Supabase
   (`batch_leads` where `enrichment_queue='priority'`,
   `enrichment_status='pending'`, and `permit_checked_at IS NULL`) into a
   local SQLite mirror.
2. **CLAIM** — atomically claims each lead (same race-safe pattern as the
   Next.js worker) so this tool and the Vercel-side worker can't both
   process the same lead.
3. **GATHER** — calls Shovels.ai directly for a real permit check. This
   does **not** go through Vercel — it works even if your deployment is
   completely down, as long as Shovels.ai itself is reachable.
4. **RECORD** — writes to a local durable outbox first: a hash-chained
   evidence event, the found permit records, and the lead's evidence patch.
   Each event chains to the previous one for that lead+claim-type, so
   tampering or silent edits are detectable.
5. **EXPORT** — flushes the outbox to Supabase (`evidence_events`,
   `permits`, `batch_leads`). If Supabase is briefly unreachable, nothing is
   lost — it stays queued locally and retries next cycle.
6. **RESCORE** — releases the lead back to `pending` and calls your deployed
   `/api/enrich/priority-worker`, which reruns the real scoring engine on
   it. If Vercel is unreachable at that moment, the lead is still sitting in
   `pending` with its permit evidence attached, so the next priority-worker
   run from any trigger picks it up.

## What it deliberately does NOT do

It does not compute `priority_score`, `confidence_score`, or `tier`. That
logic lives in exactly one place — `lib/twincities/priorityEngine.js` in
the Next.js app. A dormant Python duplicate of that scoring model
(`evidence_engine.py`) was found and explicitly rejected earlier in this
project's history — this tool does not repeat that mistake. It gathers
evidence and asks the real engine to act on it.

## Why the lead is released back to `pending`

This is the load-bearing detail, and it is easy to get wrong.
`/api/enrich/priority-worker` is the only code path that rescores a lead,
and it selects **only** rows with `enrichment_status = 'pending'`. If this
tool left a lead in a terminal status like `permit_done` or
`complete_downranked`, the permit columns would update and the lead's
`priority_score` would then be stale forever — the real engine could never
see it again. So the flow is claim → gather → write evidence *and* release
the claim → trigger the worker.

That handoff means the worker runs its own permit lookup on the same
address. To keep that from costing a second billed Shovels call, whatever
records this tool found are written into the app's own `permits` directory
first, which `/api/permit-lookup` reads before it spends an external call.
When a lookup found *nothing* there is nothing to cache, so the worker will
re-query Shovels for that address — a real, if small, duplicate cost on
empty addresses only.

The `permit_checked_at IS NULL` filter on import is what stops the release
from feeding this tool its own leads back in a loop.

## Setup

```bash
pip install -r requirements.txt
```

Copy `config.env.example` to `config.env` and fill in:
- `SUPABASE_URL` / `SUPABASE_KEY` — from Supabase project settings. The anon
  key is enough: `batch_leads` has anon select/insert/update policies, and
  `evidence_events` and `permits` both have anon select/insert (verified
  against the live project).
- `PERMIT_API_KEY` — your Shovels.ai key (optional; without it, permit
  checks run but find nothing beyond what's already in the directory)

`config.env` is gitignored. Real environment variables override it, so you
can change one setting for a single run without editing the file.

Run it:
```bash
python validator.py
```
Or on Windows, double-click `run.bat`.

Stop it any time with `Ctrl+C` — it finishes the current cycle cleanly
rather than stopping mid-write.

## Files

- `validator.py` — main loop, ties everything together
- `local_store.py` — SQLite mirror + durable outbox + hash chain storage
- `supabase_client.py` — minimal direct REST client, no SDK dependency
- `permit_lookup.py` — Shovels.ai integration, ported field-for-field from
  the Next.js app's permit-lookup route (not reinvented)
- `evidence_ledger.py` — hash-chain construction for evidence provenance
- `test_e2e.py` — mocked end-to-end test covering the full cycle, the
  offline-durability path, and the give-up path; run with
  `python test_e2e.py`

## Inspecting evidence offline

Every lead's locally-known evidence can be dumped to plain JSON, readable
with zero internet connection and no web app:
```python
from local_store import LocalStore
store = LocalStore()
store.export_lead("lead-id-here", "export_folder")
```
Produces `property.json`, `evidence.jsonl`, and `manifest.json`.

## Honest scope notes

- The Supabase side has been verified against the live project: the tables
  and columns this tool writes (`evidence_events` in full, `permits`,
  and `batch_leads`' `enrichment_*` / `permit_*` / `gap_*` columns) all
  exist, with the RLS policies the anon key needs.
- The control flow, ordering, hash chain, durability-under-failure, and the
  release-to-`pending` handoff are covered by `test_e2e.py` with mocked
  network calls. The live API calls themselves have **not** been exercised
  against real Shovels.ai or Supabase endpoints — run a small batch first
  (`AEROLEAD_BATCH_LIMIT=2`) and read the logs before trusting it at scale.
- Rescoring is eventually-consistent when Vercel is briefly unreachable.
  Evidence is saved immediately; the score update follows once any
  priority-worker run happens.
- If the process is killed between claiming a lead and the next successful
  flush, that lead sits in `enrichment_status='claimed'` until the outbox
  drains — which happens automatically on restart, since the release is a
  queued write like any other. It only sticks permanently if
  `validator_local.db` is deleted while writes are still pending. There is
  no stale-claim reaper on either this tool or the Next.js worker.
- A queued write that Supabase rejects for a reason retrying won't fix is
  parked as dead after 5 attempts rather than retried forever. Inspect them
  with:
  ```bash
  sqlite3 validator_local.db "select kind, lead_id, attempts, last_error from outbox where synced=2"
  ```
