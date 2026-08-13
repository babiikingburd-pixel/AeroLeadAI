# 90-DAY GATEKEEPER EXECUTION PLAN

## Mission

Compress the *usable portion* of a 50-year technology gap into a 90-day
engineering window without pretending that missing physical infrastructure,
regulation, training data, or scientific breakthroughs can be skipped.

## The rule

A future capability is accepted into the 90-day build only when its required
inputs, compute, APIs, data rights, and operational controls exist today.

Everything else gets an interface, simulator, adapter, or controlled pilot.

## Days 1-15 — Make the system observable

- Inventory every existing component and dependency.
- Create canonical IDs and immutable evidence/event records.
- Add provenance, confidence, freshness, timestamps, and audit logs.
- Establish health checks and rollback.
- Freeze interfaces before optimizing internals.

## Days 16-30 — Build the missing evidence layer

- Connect today's lawful data sources.
- Normalize observations into canonical objects.
- Add temporal/change detection.
- Separate raw observation from inference and action.
- Create an evidence gate so unsupported predictions cannot become actions.

## Days 31-45 — Intelligence

- Run specialized agents against the same canonical evidence.
- Require independent evidence before high-value decisions.
- Add confidence calibration and contradiction handling.
- Store every prediction with the evidence that produced it.

## Days 46-60 — Closed loop

- Connect prediction -> decision -> action -> verification -> outcome.
- Measure precision, false positives, latency, coverage, and economic result.
- Use outcomes for model evaluation rather than self-declared success.

## Days 61-75 — Controlled automation

- Shadow mode first.
- Limited pilot second.
- Expand only after measurable thresholds are met.
- Keep human override, appeals, and auditability.

## Days 76-90 — Prove the future architecture

Deliver a working vertical slice from input to verified outcome.
Do not measure success by lines of code. Measure:

1. evidence coverage
2. decision accuracy
3. time-to-action
4. human override rate
5. outcome quality
6. cost per verified opportunity
7. system recovery time

## What this makes possible

The 90-day program can reproduce the *architecture and operating loop* of
much later systems where today's primitives are sufficient.

It cannot manufacture a future satellite constellation, universal building
sensor deployment, general physical-world intelligence, or fully autonomous
societal adoption in 90 days.

## Integration boundary

This package stays property-intelligence-only. It prepares the same opportunity contract that Dial-A-Trade can consume later without merging codebases prematurely.
