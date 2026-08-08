# APEX 14.1 — Residential Top-500 Crawler Network

This build changes the Top 500 from a ranked list into a persistent investigation
workforce.

## What is new

Each of the 500 slots has a durable crawler network made of logical lanes:

1. residential — prove residential eligibility and detect exclusions
2. permits — complete permit history, one permit record at a time
3. storm — refresh storm/weather evidence
4. imagery — refresh real imagery
5. damage — run the existing real damage-analysis endpoint when imagery exists
6. development — detect residential-development/cluster signals from stored evidence
7. competition — compare the slot against the best residential challengers

The lanes are persisted in Supabase. A shared worker pool claims tasks atomically
with PostgreSQL `FOR UPDATE SKIP LOCKED`, so several crawler processes can run at
once without processing the same task twice.

## Competition model

The background scoring system continues to discover and score the wider property
population.

The Top-500 network then:

- ranks the best residential-eligible candidates
- assigns them to slots 1–500
- gives every occupied slot recurring crawler work
- stores every finding
- continuously compares slots against challengers
- releases a slot when a better residential candidate wins the ranking
- starts the new property's investigation without losing the old property's history

A property leaving the Top 500 is not deleted. Its evidence remains in
`top500_crawler_findings`, `evidence_snapshots`, permits, imagery history, and the
main lead record.

## Residential gate

`residential_status` is deliberately conservative:

- `verified` — explicit residential classification
- `probable` — strong stored residential evidence
- `excluded` — explicit commercial/non-residential evidence
- `unknown` — not enough evidence yet

Only `verified` and `probable` properties can occupy the contractor-facing
Top-500 queue. Unknown properties remain in the wider background population.

This prevents the prior problem where a very high-value commercial/apartment
property could win simply because its assessed value was large.

## Running the network

Apply:

`supabase/migrations/20260808_apex141_top500_crawler_network.sql`

Then start the normal autonomous cycle. `autonomous-cycle` now rebalances the
Top 500 and executes a slice of the persistent crawler network.

For sustained external execution:

```bash
export AERO_BASE_URL="https://your-deployment.vercel.app"
export CRON_SECRET="your-secret"
export AERO_TOP500_WORKERS=6
export AERO_TOP500_INTERVAL_SECONDS=30
python workers/top500_crawler_network_worker.py
```

The worker pool is intentionally configurable. Do not raise concurrency above
what the connected providers permit.

## Important honesty boundary

The network only records evidence returned by real configured sources. It does
not manufacture roof damage, permits, storm events, or property classifications.

The current code can reuse the real permit, weather, imagery, and damage endpoints
already present in APEX 14.0. County assessor/MLS/zoning sources remain separate
vendor integrations; the network does not pretend those sources exist when they
are not configured.

## Inspection

Run:

```bash
npm run apex:14.1-network-audit
```

The `/api/twincities/top500-network` GET endpoint exposes slot, task, and recent
finding state for operational inspection.
