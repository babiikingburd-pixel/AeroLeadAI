import crypto from "node:crypto";
import { scoreRow, validationPriority, buildValidationChecks } from "./fastCycle";

export const APEX7_VERSION = "7.0.0";

// APEX7 is an additive orchestration layer. The original score remains the
// business score; APEX7 improves evidence quality, validation order,
// throughput, reliability, idempotency, telemetry, and safe experimentation.

export function evidenceFingerprint(row) {
  const payload = {
    id: row.id ?? null,
    address: String(row.address ?? "").trim().toLowerCase(),
    year_built: row.year_built ?? null,
    assessed_value: row.assessed_value ?? null,
    hail_inches: row.hail_inches ?? null,
    wind_mph: row.wind_mph ?? null,
    storm_date: row.storm_date ?? null,
    permit_within_10y: row.permit_within_10y ?? null,
    permit_evidence_status: row.permit_evidence_status ?? null,
    image_evidence_status: row.image_evidence_status ?? null,
    last_validated_at: row.last_validated_at ?? null,
  };
  return crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

export function scoreForApex7(row) {
  const started = Date.now();
  const scored = scoreRow(row);
  const checks = buildValidationChecks(scored);
  const validation = validationPriority(scored);
  const fingerprint = evidenceFingerprint(scored);
  const confidence = Number(scored.confidence_score ?? scored.confidenceScore ?? 0);
  const evidenceCompleteness = Math.max(0, Math.min(100, 100 - checks.length * 20));
  return {
    ...scored,
    apex7_version: APEX7_VERSION,
    apex7_evidence_fingerprint: fingerprint,
    apex7_validation_priority: validation,
    apex7_validation_checks: checks,
    apex7_evidence_completeness: evidenceCompleteness,
    apex7_score_latency_ms: Date.now() - started,
    apex7_confidence_band: confidence >= 80 ? "high" : confidence >= 55 ? "medium" : "low",
  };
}

export function rankValidationBatch(rows, options = {}) {
  const now = Date.now();
  const staleAfterDays = Number(options.staleAfterDays ?? 7);
  return rows
    .map((row) => {
      const scored = scoreForApex7(row);
      const ageDays = row.last_validated_at
        ? Math.max(0, (now - Date.parse(row.last_validated_at)) / 86400000)
        : Infinity;
      const staleBoost = Math.min(25, ageDays >= staleAfterDays ? (ageDays - staleAfterDays + 1) * 2 : 0);
      const gapBoost = scored.apex7_validation_checks.length * 4;
      return { ...scored, apex7_queue_priority: Math.round((scored.apex7_validation_priority + staleBoost + gapBoost) * 100) / 100 };
    })
    .sort((a, b) => b.apex7_queue_priority - a.apex7_queue_priority);
}

export function adaptiveBatchSize({ current = 50, latencyMs = 0, errorRate = 0, max = 500, min = 10 } = {}) {
  let next = current;
  if (errorRate > 0.10 || latencyMs > 2500) next = Math.floor(current * 0.70);
  else if (errorRate < 0.02 && latencyMs < 900) next = Math.ceil(current * 1.25);
  return Math.max(min, Math.min(max, next));
}

export function retryDecision({ attempt = 1, maxAttempts = 4, retryable = true } = {}) {
  if (!retryable || attempt >= maxAttempts) return { retry: false, delayMs: 0 };
  return { retry: true, delayMs: Math.min(30000, 500 * (2 ** (attempt - 1))) + Math.floor(Math.random() * 250) };
}

export function buildApex7Telemetry({ processed = 0, succeeded = 0, failed = 0, elapsedMs = 0, queueBefore = 0, queueAfter = 0 } = {}) {
  const safe = Math.max(1, processed);
  return {
    version: APEX7_VERSION,
    processed,
    succeeded,
    failed,
    success_rate: Number((succeeded / safe).toFixed(4)),
    error_rate: Number((failed / safe).toFixed(4)),
    elapsed_ms: elapsedMs,
    rows_per_second: Number((processed / Math.max(elapsedMs / 1000, 0.001)).toFixed(2)),
    queue_before: queueBefore,
    queue_after: queueAfter,
    queue_delta: queueAfter - queueBefore,
  };
}
