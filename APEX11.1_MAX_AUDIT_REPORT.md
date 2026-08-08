# APEX 11.1 MAX — audit/debug/enhancement report

## Critical bugs fixed
1. **Image provider race:** replaced broken promise bookkeeping with `Promise.any`; the first valid image now wins while failed providers are ignored.
2. **Scoring enrichment bug:** freshly retrieved assessed value, hail, wind and driveway evidence now actually reaches the priority engine.
3. **Permit history crash risk:** malformed permit JSON no longer crashes a validation job.
4. **Permit history persistence:** returned permit records are retained instead of reducing them to a boolean.
5. **Explainability:** score breakdown/reasons are persisted during evidence rescoring.

## Operational enhancements
- Image fetch retry for transient provider failures.
- Coordinate sanity checks.
- System health endpoint with no secret leakage.
- Evidence queue stale-job recovery.
- Deterministic static audit script.
- Cumulative version is now APEX 11.1 MAX.

## Verification
The repository's existing `verify` and `doctor` scripts passed in the build environment. A full Next.js build could not be completed because the environment could not download `xlsx@0.18.5` from its package mirror; this is an environment/package-registry failure, not a reported application compile failure.

Run:
`npm ci`
`npm run verify`
`npm run doctor`
`npm run apex:max-audit`
`npm run build`

## Database
Apply all included migrations in filename order. The 10.2, 10.3 and 11.0 migrations remain part of the cumulative build.
