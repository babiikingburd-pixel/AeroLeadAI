# AeroLeadAI APEX 9.9 → 10.0

## 9.9 — Evidence Fusion + Challenger Engine
9.9 combines permit, assessor, storm and visual evidence into a single evidence-fusion score. Evidence quality is kept separate from opportunity/lead quality. The system records fusion events and supports challenger scoring.

## 10.0 — Autonomous Global Leaderboard
10.0 moves the expensive ranking calculation into PostgreSQL so the system does not fetch 152K properties through a Next.js request. `apex10_rebuild_leaderboard()` ranks the full `batch_leads` population server-side, writes rank/tier/decision fields, and records the cycle.

### Promotion rules
A property can enter `top500` only when:
- it ranks within the requested Top 500;
- evidence-fusion confidence >= 70;
- evidence quality >= 65.

A `top500_candidate` is a challenger/watch population and is not automatically presented as validated damage.

### Important distinction
`image_evidence_status=fetched` never constitutes visual verification. Visual evidence only contributes after `image_review_status` is `verified` or `adjudicated`.

## Install
1. Apply the existing APEX 9.7 migration.
2. Apply `20260805_apex99_fusion.sql`.
3. Apply `20260805_apex100_autonomous_governance.sql`.
4. Apply `20260805_apex100_global_rank.sql`.
5. Deploy the application.
6. Call `POST /api/twincities/evidence-fusion` to fuse new evidence.
7. Call `POST /api/twincities/apex-cycle` to rebuild the full leaderboard.

## Safety
The database controls table can pause autonomous cycles. Promotion thresholds are stored in `twincities_apex_controls`. APEX 10.0 is an evidence-ranking system, not a substitute for a licensed roof inspection or a claim of confirmed damage.
