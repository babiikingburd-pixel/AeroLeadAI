// lib/twincities/validationState.js
//
// THE VALIDATION STATE MACHINE
//
// Every worker that touches validation used to define its own vocabulary, and
// they disagreed. The damage that caused:
//
//   * fast-cycle looked for active jobs in ("queued","claimed","running").
//     validation-worker only ever writes "running". "claimed" was a state
//     nothing produced, so the dedupe check was reading a column for a value
//     that could not be there.
//   * priority-worker wrote image_evidence_status="verified" on a successful
//     imagery *fetch*. APEX 9.7 redefined that column as retrieval state only
//     and moved assessment to image_review_status — but only validation-worker
//     was updated, so priority-worker kept minting rows that claim an image
//     was verified when nobody has looked at it.
//   * validation-worker also wrote "skipped_permit_gate" into the same column
//     from priority-worker, a third vocabulary again.
//   * apex7 filtered leads on validation_status values ("pending", "unknown",
//     "needs_validation") that no writer in the codebase produces.
//
// So: one module owns the states, the legal transitions, and the patch shapes.
// Workers import from here. A state that is not in these tables is a bug, and
// assertTransition() will say so rather than letting it reach the database.

// ---------------------------------------------------------------------------
// Evidence dimension status. Shared by permit_evidence_status,
// value_evidence_status and storm_evidence_status.
//
//   unknown    -> never attempted. NOT a negative signal.
//   failed     -> attempted, errored out. Retry-able. NOT a negative signal.
//   none_found -> attempted, completed, genuinely nothing there. RESOLVED.
//   found      -> attempted, records returned, not yet corroborated.
//   verified   -> attempted, records returned, corroborated.
// ---------------------------------------------------------------------------
export const EVIDENCE_STATUS = Object.freeze({
  UNKNOWN: "unknown",
  FAILED: "failed",
  NONE_FOUND: "none_found",
  FOUND: "found",
  VERIFIED: "verified",
});

export const RESOLVED_EVIDENCE_STATES = Object.freeze(
  new Set([EVIDENCE_STATUS.FOUND, EVIDENCE_STATUS.VERIFIED, EVIDENCE_STATUS.NONE_FOUND])
);
export const OPEN_EVIDENCE_STATES = Object.freeze(
  new Set([EVIDENCE_STATUS.UNKNOWN, EVIDENCE_STATUS.FAILED])
);

export function isResolved(status) {
  return RESOLVED_EVIDENCE_STATES.has(status);
}

// ---------------------------------------------------------------------------
// Imagery. Two columns, two different questions, and conflating them is what
// APEX 9.6 got wrong.
//
//   image_evidence_status  -> did we RETRIEVE a picture. Never an assessment.
//   image_review_status    -> did somebody or something LOOK at it.
//
// "verified" is deliberately absent from the retrieval set. Use
// imageRetrievalPatch() rather than writing the column by hand.
// ---------------------------------------------------------------------------
export const IMAGE_RETRIEVAL_STATUS = Object.freeze({
  UNKNOWN: "unknown",
  FETCHED: "fetched",
  FAILED: "failed",
  SKIPPED_PERMIT_GATE: "skipped_permit_gate",
  SKIPPED_NO_BUDGET: "skipped_no_budget",
});

export const IMAGE_REVIEW_STATUS = Object.freeze({
  UNREVIEWED: "unreviewed",
  VERIFIED: "verified",
  ADJUDICATED: "adjudicated",
  REJECTED: "rejected",
});

/** A review result that terminates the imagery question. */
export const REVIEWED_IMAGE_STATES = Object.freeze(
  new Set([IMAGE_REVIEW_STATUS.VERIFIED, IMAGE_REVIEW_STATUS.ADJUDICATED])
);

export function isImageReviewed(row) {
  return REVIEWED_IMAGE_STATES.has(row?.image_review_status);
}

/**
 * The only supported way to record an imagery fetch. Returns the column patch,
 * so no caller has to remember that a successful fetch is "fetched" and never
 * "verified".
 */
export function imageRetrievalPatch(outcome, at = new Date().toISOString()) {
  const status =
    outcome === true || outcome === IMAGE_RETRIEVAL_STATUS.FETCHED
      ? IMAGE_RETRIEVAL_STATUS.FETCHED
      : outcome === false || outcome === IMAGE_RETRIEVAL_STATUS.FAILED
        ? IMAGE_RETRIEVAL_STATUS.FAILED
        : outcome;
  if (!Object.values(IMAGE_RETRIEVAL_STATUS).includes(status)) {
    throw new Error(`imageRetrievalPatch: "${status}" is not an image retrieval state`);
  }
  return {
    image_evidence_status: status,
    image_fetched_at: status === IMAGE_RETRIEVAL_STATUS.FETCHED ? at : null,
  };
}

// ---------------------------------------------------------------------------
// batch_leads.validation_status — the lead's own validation state.
// ---------------------------------------------------------------------------
export const LEAD_VALIDATION_STATUS = Object.freeze({
  UNVALIDATED: "unvalidated",
  NEEDS_MORE_EVIDENCE: "needs_more_evidence",
  PARTIAL: "partial",
  VALIDATED: "validated",
});

/** Leads a validation worker should still pick up. */
export const OPEN_LEAD_VALIDATION_STATES = Object.freeze([
  LEAD_VALIDATION_STATUS.UNVALIDATED,
  LEAD_VALIDATION_STATUS.NEEDS_MORE_EVIDENCE,
  LEAD_VALIDATION_STATUS.PARTIAL,
]);

// ---------------------------------------------------------------------------
// twincities_validation_jobs.status — the job lifecycle.
//
//   queued -> running -> completed
//                     -> queued    (retry, bounded by MAX_ATTEMPTS)
//                     -> failed    (terminal: attempts exhausted, or the
//                                   property does not exist)
// ---------------------------------------------------------------------------
export const JOB_STATUS = Object.freeze({
  QUEUED: "queued",
  RUNNING: "running",
  COMPLETED: "completed",
  FAILED: "failed",
});

/** A job in one of these states already owns its property; do not re-queue it. */
export const ACTIVE_JOB_STATUSES = Object.freeze([JOB_STATUS.QUEUED, JOB_STATUS.RUNNING]);

export const TERMINAL_JOB_STATUSES = Object.freeze([JOB_STATUS.COMPLETED, JOB_STATUS.FAILED]);

const LEGAL_TRANSITIONS = Object.freeze({
  [JOB_STATUS.QUEUED]: [JOB_STATUS.RUNNING, JOB_STATUS.FAILED],
  [JOB_STATUS.RUNNING]: [JOB_STATUS.COMPLETED, JOB_STATUS.FAILED, JOB_STATUS.QUEUED],
  [JOB_STATUS.COMPLETED]: [],
  [JOB_STATUS.FAILED]: [],
});

export function canTransition(from, to) {
  return (LEGAL_TRANSITIONS[from] || []).includes(to);
}

export function assertTransition(from, to) {
  if (!canTransition(from, to)) {
    throw new Error(`Illegal validation job transition: ${from} -> ${to}`);
  }
  return to;
}

// ---------------------------------------------------------------------------
// Retry policy.
//
// The pre-10.1 worker requeued every failure at a flat 15 minutes and never
// read `attempts`, so a job that could not succeed — a malformed address, a
// permit provider returning 500 — retried forever, spending a paid lookup each
// time. Bounded attempts, exponential backoff, full jitter.
// ---------------------------------------------------------------------------
export const MAX_ATTEMPTS = Number(process.env.VALIDATION_MAX_ATTEMPTS ?? 4);
export const RETRY_BASE_MS = Number(process.env.VALIDATION_RETRY_BASE_MS ?? 60_000);
export const RETRY_CAP_MS = Number(process.env.VALIDATION_RETRY_CAP_MS ?? 6 * 60 * 60 * 1000);

/**
 * Backoff for the NEXT attempt after `attempt` have been made: 1m, 2m, 4m, 8m…
 * capped at RETRY_CAP_MS, with full jitter so a batch that fails together does
 * not come back as a synchronized thundering herd.
 */
export function retryDelayMs(attempt, { jitter = true } = {}) {
  const exponent = Math.max(0, Number(attempt) - 1);
  const ceiling = Math.min(RETRY_BASE_MS * 2 ** exponent, RETRY_CAP_MS);
  return Math.round(jitter ? ceiling / 2 + Math.random() * (ceiling / 2) : ceiling);
}

export function attemptsExhausted(attempts) {
  return Number(attempts || 0) >= MAX_ATTEMPTS;
}

// ---------------------------------------------------------------------------
// Job patch builders. Each returns exactly the columns to write, so the
// lifecycle lives here instead of being re-derived at four call sites.
// ---------------------------------------------------------------------------
export function claimJobPatch(job, workerId, now = new Date()) {
  assertTransition(job.status ?? JOB_STATUS.QUEUED, JOB_STATUS.RUNNING);
  return {
    status: JOB_STATUS.RUNNING,
    claimed_by: workerId,
    claimed_at: now.toISOString(),
    attempts: Number(job.attempts || 0) + 1,
  };
}

export function completeJobPatch(now = new Date()) {
  return {
    status: JOB_STATUS.COMPLETED,
    completed_at: now.toISOString(),
    last_error: null,
    next_attempt_at: null,
  };
}

/**
 * Retry or give up, decided here rather than at the call site.
 * `attempts` is the count INCLUDING the attempt that just failed.
 */
export function failJobPatch(attempts, error, { terminal = false, now = new Date() } = {}) {
  const used = Number(attempts || 0);
  const message = error?.message ?? String(error ?? "unknown error");
  if (terminal || attemptsExhausted(used)) {
    return {
      patch: {
        status: JOB_STATUS.FAILED,
        last_error: terminal ? message : `${message} (gave up after ${used} attempts)`,
        completed_at: now.toISOString(),
        next_attempt_at: null,
      },
      retrying: false,
      attempts: used,
    };
  }
  const delay = retryDelayMs(used);
  return {
    patch: {
      status: JOB_STATUS.QUEUED,
      last_error: message,
      completed_at: null,
      next_attempt_at: new Date(now.getTime() + delay).toISOString(),
    },
    retrying: true,
    attempts: used,
    retryInMs: delay,
  };
}
