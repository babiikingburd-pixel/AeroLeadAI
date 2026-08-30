import { createHash, randomUUID } from "node:crypto";
import type { EvidenceReality, EvidenceRecord, EvidenceType } from "./contracts";

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function makeEvidence(input: {
  parcelId: string; type: EvidenceType; provider: string; reality: EvidenceReality;
  payload?: Record<string, unknown>; confidence?: number; effectiveAt?: string; sourceRef?: string;
}): EvidenceRecord {
  const capturedAt = new Date().toISOString();
  const payload = input.payload || {};
  const contentHash = createHash("sha256").update(stable({ ...input, payload, capturedAt })).digest("hex");
  return {
    id: randomUUID(), parcelId: input.parcelId, type: input.type, provider: input.provider,
    reality: input.reality, capturedAt, effectiveAt: input.effectiveAt, sourceRef: input.sourceRef,
    confidence: Math.max(0, Math.min(1, input.confidence ?? 0)), payload, contentHash,
  };
}

export function unavailable(parcelId: string, type: EvidenceType, provider: string, reason: string): EvidenceRecord {
  return makeEvidence({ parcelId, type, provider, reality: "UNAVAILABLE", payload: { reason }, confidence: 0 });
}
