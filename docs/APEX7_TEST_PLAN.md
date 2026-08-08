# APEX7 verification checklist

- JS syntax-check all newly added `.js` modules and API routes.
- Confirm APEX7 route loads without changing existing routes.
- Verify deterministic evidence fingerprints for identical evidence.
- Verify validation ranking puts larger evidence gaps/freshness higher.
- Verify adaptive batching shrinks under high latency/error and grows under healthy conditions.
- Verify retry policy stops at max attempts.
- Verify experiment gate rejects insufficient observations and queues unapproved changes.
- Run existing evidence-index Python tests where dependencies are available.
- Run `npm run build` in an environment with the project's package registry available.
