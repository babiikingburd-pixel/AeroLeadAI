export const PROPERTY_PAGE_MAX = 500;
export const PROPERTY_PAGE_DEFAULT = 100;

export function clampPropertyLimit(raw, { min = 1, max = PROPERTY_PAGE_MAX, fallback = PROPERTY_PAGE_DEFAULT } = {}) {
  const number = Number(raw);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(Math.trunc(number), max));
}

export function clampPropertyOffset(raw, { min = 0, max = 50_000 } = {}) {
  const number = Number(raw);
  if (!Number.isFinite(number)) return min;
  return Math.max(min, Math.min(Math.trunc(number), max));
}

export function summarizeRankCounts(ranks = []) {
  const valid = ranks
    .map((value) => Number(value?.live_rank ?? value))
    .filter((rank) => Number.isFinite(rank) && rank > 0);
  return {
    top100Count: valid.filter((rank) => rank <= 100).length,
    top500Count: valid.filter((rank) => rank <= 500).length,
  };
}
