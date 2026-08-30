import type { EvidenceRecord, GateDecision } from "./contracts";

const real = (r: EvidenceRecord) => r.reality === "REAL_NOW" || r.reality === "CACHED_REAL";
const text = (r: EvidenceRecord) => JSON.stringify(r.payload).toLowerCase();
const yearsSince = (value?: string) => value ? (Date.now() - new Date(value).getTime()) / 31_557_600_000 : null;

export function evaluateEvidence(records: EvidenceRecord[]): GateDecision {
  const usable = records.filter(real);
  const types = new Set(usable.map(r => r.type));
  const contradictions: string[] = [];
  const corroborations: string[] = [];
  const reasons: string[] = [];
  let opportunity = 0;

  const structure = usable.filter(r => r.type === "STRUCTURE");
  const permits = usable.filter(r => r.type === "PERMIT");
  const weather = usable.filter(r => r.type === "WEATHER");
  const imagery = usable.filter(r => r.type === "IMAGERY");
  const yearBuilt = structure.map(r => Number((r.payload as any).year_built ?? (r.payload as any).yearBuilt)).find(Number.isFinite);
  const roofAge = yearBuilt ? new Date().getUTCFullYear() - yearBuilt : null;
  if (roofAge !== null && roofAge >= 20) { opportunity += Math.min(20, (roofAge - 15) * 0.8); reasons.push(`Structure age prior: ${roofAge} years`); }

  const roofPermits = permits.filter(r => /roof|shingle|reroof/.test(text(r)));
  const latestPermit = roofPermits.map(r => yearsSince(r.effectiveAt)).filter((v): v is number => v !== null).sort((a,b) => a-b)[0];
  if (latestPermit !== undefined && latestPermit <= 7) { opportunity -= 45; reasons.push("Recent roofing permit is strong counter-evidence"); }
  else if (latestPermit !== undefined && latestPermit <= 15) { opportunity -= 12; reasons.push("Roofing permit 8–15 years old is mild counter-evidence"); }

  const stormSignals = weather.filter(r => /hail|high wind|thunderstorm wind|tornado/.test(text(r)));
  if (stormSignals.length) { opportunity += Math.min(22, stormSignals.length * 5); reasons.push(`${stormSignals.length} relevant storm record(s)`); }
  const damageSignals = imagery.filter(r => Number((r.payload as any).damage_probability ?? (r.payload as any).damageProbability ?? 0) >= 0.65);
  if (damageSignals.length) { opportunity += 48 * Math.max(...damageSignals.map(r => Number((r.payload as any).damage_probability ?? (r.payload as any).damageProbability))); reasons.push("Qualified imagery damage signal"); }

  if (damageSignals.length && stormSignals.length) corroborations.push("Imagery and weather evidence agree");
  if (damageSignals.length && latestPermit !== undefined && latestPermit <= 7) contradictions.push("Imagery signal conflicts with recent roofing permit");
  if (stormSignals.length && latestPermit !== undefined && latestPermit <= 7) contradictions.push("Storm exposure occurred near a recently permitted roof; chronology requires review");

  if (corroborations.length) opportunity *= 1.12;
  const evidenceConfidence = usable.length ? usable.reduce((sum, r) => sum + r.confidence, 0) / usable.length : 0;
  const completionPct = Math.round((types.size / 4) * 100);
  opportunity = Math.round(Math.max(0, Math.min(100, opportunity)));
  const allowed = evidenceConfidence >= 0.65 && types.size >= 2 && contradictions.length === 0 && opportunity >= 35;
  const state = contradictions.length ? "REVIEW_REQUIRED" : types.size >= 4 && allowed ? "PROFILE_COMPLETE" : allowed ? "EVIDENCE_VERIFIED" : "EVIDENCE_PARTIAL";
  const deepDiveTier = opportunity >= 80 && evidenceConfidence >= 0.8 ? "TOP_100" : opportunity >= 55 ? "TOP_500" : "STANDARD";
  if (!usable.length) reasons.push("No real evidence is currently available");
  return { allowed, state, reasons, contradictions, corroborations, opportunity, evidenceConfidence: Number(evidenceConfidence.toFixed(3)), commercialPriority: Math.round(opportunity * evidenceConfidence), completionPct, deepDiveTier };
}
