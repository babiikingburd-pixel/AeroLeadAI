# AeroLeadAI — Handoff Instructions (current as of this build)

Work autonomously. Verify everything you report — do not claim success you
have not checked. This supersedes any earlier CLAUDE_CODE_*.md file in this
project if one already exists locally — this one reflects the actual current
state of the code.

---

## CONTEXT

- Vercel project: `aero-lead-ai`, team `babiikingburd-5457's projects`
- Production domain: `aero-lead-ai.vercel.app`
- GitHub repo: `babiikingburd-pixel/AeroLeadAI`
- Supabase project ref: `dikxsdjlrbdowozjkefw`
- **Confirmed Vercel plan: free/Hobby**, not Pro. This matters in Step 5.

**Already correct in the live database — do NOT modify:**
- 152,203 leads; 136,904 classified `likely_residential`
- Priority scoring, evidence status columns (`permit_evidence_status` etc.,
  using `unknown`/`found`/`verified`/`none_found`/`failed`, never true/false),
  TTL columns (`permit_checked_at`, `value_checked_at`, `image_fetched_at`),
  job-claiming columns, and `score_history` table all exist and are correct.
- Top 500 residential leads are in the priority enrichment queue.

## STEP 1 — Password gate (`components/AuthGate.jsx`)

Check, don't assume — confirm ALL of these directly in the file:

1. No bypass for `/twincities`. Only `/portal/` may bypass (homeowner portal,
   protected by its own per-job token).
2. Password box renders unconditionally when locked — not gated behind a
   `supabase ? ... : ...` check (Supabase magic-link doesn't deliver here).
3. `ACCESS_PASSWORD = "aero2026"`, compared case-insensitively.
4. Unlock persists to `localStorage` (`aero_unlocked`).
5. `app/layout.jsx` wraps `{children}` in `<AuthGate>`.

If any of these is wrong, fix it. If a prior session already fixed this,
confirm it's still correct — don't assume, verify.

## STEP 2 — Do not revert `permitChecked`

`lib/twincities/priorityEngine.js`'s `scoreConfidence` must check
`lead.permitChecked === true`, not `lead.permit_within_10y !== null`. The
latter falsely reports "checked" on the unpopulated default `false` that
every one of the 152,203 rows started with. If you find the old check,
that's a regression — put it back to `permitChecked`. This is confirmed
correct behavior, verified against the live database more than once this
session, not a guess.

## STEP 3 — Confirm the enrichment architecture is intact

These files should exist and reference each other — if `lib/twincities/
evidenceEvents.js` is missing, something regressed:

- `lib/twincities/evidenceEvents.js` — `applyEvidenceAndRescore()`, the one
  shared function all workers below call. Now also writes a hash-chained
  event to `evidence_events` on every rescore (Node's built-in `crypto`,
  no dependency added). Don't let it get "simplified" back into duplicated
  inline logic — that duplication caused real bugs earlier in this project.
- `app/api/enrich/storm-backfill/route.js` — NOAA backfill. Takes `{year,
  radiusMiles, limit, offset, dryRun, prioritizeQueue}`. Paginates
  internally; calling it once will NOT cover all 152,203 leads.
- `app/api/enrich/priority-worker/route.js` — permit lookup (GET, not
  POST) → rescore → permit gate → imagery → auto-refills the queue via
  `promote-queue` after every run.
- `app/api/enrich/gap-router/route.js` — routes permit/value/image gaps
  (storm deliberately excluded — bulk work, not per-lead ROI work).
- `app/api/enrich/promote-queue/route.js` — refill the priority queue;
  supports `targetSize` self-maintaining mode.
- `app/api/enrich/validate-all/route.js` — attempts every evidence
  dimension for queued leads, honestly reporting capability gaps via
  `lib/twincities/validationCapabilities.js`.
- `lib/twincities/priorityEngine.js` — `calculatePriority()` returns a
  `reasons` array (ordered, labeled contributions) alongside the scores.

### Twin Cities fast-validation layer (added this round)

- `app/api/top-leads/route.js` — now READ-ONLY. No longer recalculates and
  writes hundreds of rows on every dashboard GET (that was the cause of a
  real "Unexpected token, not valid JSON" timeout failure mode). Reads
  persisted `priority_score`/`confidence_score` instead.
- `lib/twincities/fastCycle.js` + `app/api/twincities/fast-cycle/route.js`
  — bounded six-county scoring pass. Persists scores in chunks of 50,
  queues validation jobs (deduped against already-active jobs) into
  `twincities_validation_jobs`.
- `app/api/twincities/validation-worker/route.js` — drains that job queue.
  Permit + assessor value checks run CONCURRENTLY (`Promise.all`,
  concurrency capped at 4); imagery is gated behind the permit result,
  same pattern as `priority-worker`. Correctly calls the GET permit-lookup,
  not the broken POST manual-save endpoint.
- `app/api/twincities/autonomous-cycle/route.js` — orchestrates
  fast-cycle → validation-worker → re-reads the current Top 500 cutoff.
  Wired into `vercel.json` as a daily cron (`30 1 * * *`, Hobby-plan
  once/day limit applies same as the other 5 crons already there).
- `workers/twincities_autonomous_worker.py` — a SEPARATE, simpler tool
  from the standalone validator delivered earlier: this one just calls
  `/api/twincities/autonomous-cycle` on a timer (no local evidence
  gathering, no offline durability, no direct-to-Supabase capability — if
  Vercel is down, this does nothing but retry). Useful as a "keep hitting
  the endpoint on a schedule" driver distinct from the standalone
  validator's deeper independent-evidence role. Both can coexist.

**Consolidation note**: an earlier version of this batch created a SECOND
evidence-events table (`twincities_evidence_events`) with hash-chain
columns that were never actually populated. That table was NOT created —
`evidenceEvents.js` was fixed to write into the one already-live
`evidence_events` table instead (used by both the Vercel-side workers and
the standalone Python validator). If you see any reference to
`twincities_evidence_events` anywhere, that's stale — redirect it to
`evidence_events` with `lead_id`, not `property_id`.

## STEP 4 — Build

```bash
npm install
npx next build
```
Must complete clean. A `CssSyntaxError: <css input>:1:6: Unknown word`
warning is pre-existing, non-fatal, and unrelated to anything in this
project — ignore it, don't chase it.

## STEP 5 — Deploy to PRODUCTION, then verify for real

```bash
npx vercel --prod
```
Link to the EXISTING `aero-lead-ai` project. `--prod` is mandatory — a plain
`npx vercel` produces a preview URL, which is a failure mode that has
already happened once and left fixes un-live.

Then:
```bash
curl -s https://aero-lead-ai.vercel.app/twincities | head -60
```
PASS = minimal/empty body (client-rendered gate). FAIL = the dashboard HTML
is present (e.g. "TWIN CITIES PRIORITY ENGINE", `/discovery`, `/crm` links).
If FAIL, the gate isn't live — diagnose and redeploy before doing anything else.

## STEP 6 — Run enrichment, in chunks, in this order

**Free/Hobby plan means `maxDuration: 300` in the route files is aspirational,
not real.** A single call trying to process all 152,203 leads will very
likely time out mid-run. Call these repeatedly with modest batch sizes —
do not attempt one giant call for either route below.

**6a. Storm backfill — dry run first:**
```bash
curl -X POST https://aero-lead-ai.vercel.app/api/enrich/storm-backfill \
  -H "Content-Type: application/json" \
  -d '{"year":2025,"dryRun":true,"radiusMiles":3,"limit":5000,"offset":0}'
```
If `eventsFound` is 0, try `"year":2024`.

**6b. Storm backfill for real, chunked:**
```bash
curl -X POST https://aero-lead-ai.vercel.app/api/enrich/storm-backfill \
  -H "Content-Type: application/json" \
  -d '{"year":2025,"radiusMiles":3,"limit":5000,"offset":0}'
```
The response includes `nextOffset` and a `note` telling you whether more
remain. Repeat with `offset` advancing (0, 5000, 10000, ...) until the note
says "Reached end of table." This will take many calls — that's expected,
not a bug. Each successful call rescores matched leads and writes to
`score_history` automatically (via `applyEvidenceAndRescore`) — you do not
need a separate rescore step.

**6c. Check coverage moved:**
```bash
curl -s https://aero-lead-ai.vercel.app/api/data-coverage
```
Hail/wind/storm_date should be non-zero after 6b. If still 0, something
didn't write — investigate before continuing.

**6d. Drain the priority queue (permit lookup, 25 at a time):**
```bash
curl -X POST https://aero-lead-ai.vercel.app/api/enrich/priority-worker \
  -H "Content-Type: application/json" -d '{"limit":25}'
```
Repeat as many times as you have budget for. Watch `summary.gated_out_before_imagery`
and `summary.dropped_after_permit_check` — leads SHOULD drop when a recent
roof permit is found. That's correct behavior, not a bug.

Requires `PERMIT_API_KEY` (Shovels.ai) set in Vercel env vars for real
lookups — report whether it's configured; without it, results will be sparse.

**6e. Gap router — preview only, do not commit blindly:**
```bash
curl -s "https://aero-lead-ai.vercel.app/api/enrich/gap-router?limit=500"
```
Review before running with `{"commit":true}`.

## STEP 7 — Report back

1. Production URL + deployment ID, and the literal curl output proving the
   gate is live
2. Any files changed in Steps 1–3 and why
3. Storm backfill: how many chunks run, final coverage numbers (before/after)
4. Priority worker: leads processed, how many gated out on permit
5. Whether `PERMIT_API_KEY` is configured
6. Anything that failed and is still outstanding

---

## DO NOT DO

- Do not modify the database schema or re-run migrations — already correct.
- Do not create a new Vercel project.
- Do not remove AuthGate or add bypass paths.
- Do not revert `permitChecked` (Step 2).
- Do not re-duplicate the rescore logic that `evidenceEvents.js` centralizes
  — if you need a crawler to update a score, call `applyEvidenceAndRescore`,
  don't hand-roll another `calculatePriority` + update + history-insert block.
- Do not enable Vercel's own password protection — fails on this (free) plan.
- Do not attempt storm-backfill or priority-worker in one unchunked call —
  see Step 6's plan-tier warning.
- Do not lower tier thresholds to make more leads look "sales-ready." Low
  tier counts are currently correct given how little evidence has been
  gathered — that should improve as Step 6 actually runs, not by changing
  the classification math.
