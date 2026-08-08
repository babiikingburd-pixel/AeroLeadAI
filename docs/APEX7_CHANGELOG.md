# AeroLeadAI APEX7 — Unified + Seven Improvement Passes

## Integration spine
Twin Cities Fast Validation V2 remains the compatibility spine. Existing scoring, evidence events, queue workers, routes, migrations, and UI are preserved.

## Integrated systems
- Twin Cities fast validation V2
- Property Intelligence modules and console assets
- Self-improvement experiment/ranking/memory services

## Seven improvement passes
1. Canonical evidence fingerprints and explicit evidence completeness.
2. Validation-gap prioritization with freshness and unresolved-gap boosts.
3. Adaptive batch sizing based on latency and error rate.
4. Exponential retry/backoff decisions with bounded attempts.
5. Idempotent evidence identity via SHA-256 fingerprints.
6. Pipeline telemetry for throughput, success/error rate, and queue movement.
7. Controlled self-evolution gates: minimum observations, measurable improvement, tests, then explicit human approval.

## Safety / compatibility
The original business score is not replaced. APEX7 is additive and exposes enriched score/queue metadata. Self-improvement code is kept separate and cannot deploy code by itself.
