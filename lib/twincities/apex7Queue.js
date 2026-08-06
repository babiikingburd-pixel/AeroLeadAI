import { adaptiveBatchSize, retryDecision } from "./apex7Engine";

export function chooseWork(rows, limit = 100) {
  return [...rows]
    .sort((a, b) => Number(b.apex7_queue_priority ?? b.validation_priority ?? 0) - Number(a.apex7_queue_priority ?? a.validation_priority ?? 0))
    .slice(0, Math.max(1, Math.min(limit, 500)));
}

export function nextBatchState(state = {}) {
  return {
    ...state,
    batchSize: adaptiveBatchSize(state),
    retry: retryDecision(state),
  };
}
