# GateKeeper 2.3 — Exit-Signal Driver

v2.2 stays fully intact — `v2/`, `engines/` (except the one new file below),
`adapters/`, `harness/`, and `investigation/` are all unchanged. This version
adds exactly one thing: the wiring gap identified at the end of v2.2's
walkthrough — "OnboardingSession only captures memory when its own `with`
block closes; nothing connects an external exit signal to that closure."

## Added

- `gatekeeper/engines/session_driver.py` — `SessionDriver`. A persistent-state
  wrapper around the same `MemoryArchiver` that `OnboardingSession` uses.
  Because each CLI invocation is its own process (a `with` block can't stay
  open across separate calls), state is carried forward in
  `gatekeeper/data/.session_state.json` between `start` / `log` calls, and
  `exit` reads that state, builds the identical session-record shape
  `OnboardingSession.__exit__` would have built, writes the next versioned
  memory zip via `MemoryArchiver.write_snapshot()`, and deletes the state
  file. A second `exit` with no active session raises instead of silently
  no-op'ing.
- CLI: `python -m gatekeeper.engines.session_driver <start|log|exit|status>`
- `tests/test_session_driver.py` — 5 new tests: exit-without-start raises,
  start/log/log/exit produces a real zip containing every logged note in
  order, state file is cleared after exit (and a repeat exit raises),
  double-start without exit raises, cumulative history grows correctly
  across two full start→exit cycles.

## Live verification (not simulated)

Ran the actual CLI three times in sequence — `start --agent Claude`, two
`log` calls, `exit` — against this package on a real filesystem. Result:
`gatekeeper/data/memory/gatekeeper_memory_v1.1.zip` was written for real;
reading `session_current.json` back out of it shows all three logged notes
plus the session-start and exit events, in order, with real timestamps.
Confirmed via `zipfile` read, not asserted from memory.

## What this still does NOT do

`session_driver.py` closes the "exit" wiring gap for a code-execution
session where something actually calls `start`, `log`, and `exit`. It does
not make a plain chat conversation (no code execution) automatically invoke
any of this — that distinction from the v2.2 write-up still holds. Ending a
conversation with no code execution happening still writes nothing.

## Test status

58/58 passing (53 carried over from v2.2 + 5 new, zero modifications to any
prior test or to `v2/`, `harness/`, or `investigation/`).
