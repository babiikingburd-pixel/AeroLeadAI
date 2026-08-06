# AeroLeadAI — APEX 10.0, evidence-gated, database-verified

Base tree: the APEX9_9-10_0-global-evidence.zip you uploaded (9.7 evidence
gate + 9.9 fusion + 10.0 governance), with the evidence-debt/confidence-floor
layer from the 9.6 merge carried forward on top, and four defects in the 10.0
SQL fixed directly against your live database.

Build-verified: `npm run doctor` READY, `npm run verify` pass, `npm run
apex:status` READY, `npm run apex:cycle` OK, `next build` compiled, 96 static
pages.

---

## What's actually live against dikxsdjlrbdowozjkefw right now

I ran every migration in this zip against your real database, not just
build-checked the code. Current state:

- **SSRF closed.** The `http` extension was reachable via `/rest/v1/rpc/*` by
  anyone holding the publishable key. `ALTER EXTENSION ... SET SCHEMA` isn't
  supported by this extension and a plain `REVOKE` on it is a silent no-op for
  non-owners — I confirmed both failure modes before finding the fix. It's now
  dropped and recreated in `extensions`, outside PostgREST's exposed schema.
  `discover_city_addresses`, `fetch_mn_storm_events`, `sync_metrogis_parcels`
  are hard-revoked from anon/authenticated and `search_path`-pinned.

- **`crawler_runs` created** (was referenced by code, never defined anywhere
  in any zip). RLS on, no browser-key policy.

- **All 9.7/9.9/10.0 columns and tables applied**, including two the shipped
  migrations needed but never created — `image_damage_score` and
  `image_visibility_score`. Both `evidenceFusion.js` and
  `apex10_rebuild_leaderboard` read them. Without them the leaderboard
  function would have errored on its first real execution (plpgsql bodies
  aren't validated until run, so this wouldn't have surfaced until someone
  actually called it in production).

- **`apex10_rebuild_leaderboard` rewritten.** The shipped version had four
  problems, found by reading it line by line, not by running it and watching
  it fail:
  1. The fusion formula was written out twice — once in the ranking
     `ORDER BY`, once in the `UPDATE` that persists `evidence_fusion_score` —
     and the two copies disagreed: the ranking expression included a
     `corroboration >= 2 → +8` bonus that the stored score omitted. Rank and
     stored score were two different orderings wearing one function name.
  2. It rewrote all 152,203 rows on every call. Now only rows whose rank,
     tier, or fused score changed are written.
  3. It never consulted `promotion_streak`, so a lead could promote and
     demote on back-to-back cycles — exactly the thrashing the stability gate
     exists to prevent. Promotion now requires the streak to clear
     `p_stability_cycles` before `apex_tier` becomes `'top500'`.
  4. `SECURITY DEFINER` with no execute revoke — callable by anon or
     authenticated straight through `/rest/v1/rpc/apex10_rebuild_leaderboard`,
     capable of rewriting your entire scoring table from a browser key.
     Changed to `SECURITY INVOKER`, `search_path` pinned, execute restricted
     to `postgres`/`service_role`.

  The corrected function is both applied live and committed in
  `supabase/migrations/20260805b_apex100_global_rank_corrected.sql` — don't
  run the original `20260805_apex100_global_rank.sql` alone against a fresh
  database; apply the `b` file after it (or instead of it).

## What's new in this zip vs. the 9.6 build

- `app/api/twincities/evidence-fusion`, `app/api/twincities/apex-cycle`,
  `lib/twincities/evidenceFusion.js` — the fusion/leaderboard layer. Verified
  `evidenceFusion.js` routes through `applyEvidenceAndRescore`, same canonical
  path as everything else — it is not a parallel scorer.
- `fast-cycle` now rotates through the full eligible population by page
  instead of rescanning the same slice — 9.6 could scan forever and never
  touch most of the 152K.
- `validation-worker` now separates image **fetch** from image **review**.
  9.6 called a successful download "verified"; that's exactly the gap flagged
  earlier in this thread. Also: failed jobs go back to `queued` instead of a
  dead-end `failed` status, so the retry loop the schema already supports
  actually gets used.

## Carried forward from the 9.6 evidence-debt work

`lib/twincities/evidenceDebt.js`, the confidence-floor gate in
`/api/review-queue`, and the tunable (default-unchanged) value weighting in
`priorityEngine.js` — all copied in unmodified. This governs your Top 100
human-review queue and is independent of, and stricter than, the new
`apex_tier` leaderboard. Nothing here duplicates fusion; it decides
visibility and validation order, fusion decides score.

## Still outstanding — nothing here runs itself yet

- **Storm backfill has still never been executed.** `storm_evidence_status`
  is 0/152,203 checked as of this session. This is the free, highest-leverage
  action and the biggest blocker on every score above depending on it.
- **`PERMIT_API_KEY` billing has not been confirmed or budgeted.** Don't run
  permit lookups past the Top 500 (or at all) until you've priced it.
- `damage-agent` (the Claude vision pipeline) still isn't called anywhere in
  the Twin Cities loop — `image_review_status` will stay `'unreviewed'` until
  something wires it into `validation-worker` or `apex-cycle`.
- `apex_tier='top500'` requires `promotion_streak >= p_stability_cycles`
  (default 2), so the first call to `apex10_rebuild_leaderboard` after storm
  data lands will move properties to `top500_candidate`, not `top500` — that
  needs a second cycle to confirm. This is intentional, not a bug: it's the
  promotion-stability behavior you asked for.
