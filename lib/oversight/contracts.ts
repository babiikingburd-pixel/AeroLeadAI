export const EVIDENCE_TYPES = ["STRUCTURE", "PERMIT", "WEATHER", "IMAGERY", "PROPERTY", "OWNERSHIP", "COMMERCIAL"] as const;
export const REALITY = ["REAL_NOW", "CACHED_REAL", "SAMPLE", "UNKNOWN", "UNAVAILABLE"] as const;

export type EvidenceType = (typeof EVIDENCE_TYPES)[number];
export type EvidenceReality = (typeof REALITY)[number];

export interface ParcelContext {
  parcelId: string;
  address: string;
  latitude?: number;
  longitude?: number;
  zip?: string;
  county?: string;
  state?: string;
}

export interface EvidenceRecord {
  id: string;
  parcelId: string;
  type: EvidenceType;
  provider: string;
  reality: EvidenceReality;
  capturedAt: string;
  effectiveAt?: string;
  sourceRef?: string;
  contentHash?: string;
  confidence: number;
  payload: Record<string, unknown>;
}

export interface EvidenceProvider {
  readonly name: string;
  readonly type: EvidenceType;
  collect(parcel: ParcelContext, signal?: AbortSignal): Promise<EvidenceRecord[]>;
}

export interface GateDecision {
  allowed: boolean;
  state: "EVIDENCE_PARTIAL" | "EVIDENCE_VERIFIED" | "REVIEW_REQUIRED" | "PROFILE_COMPLETE";
  reasons: string[];
  contradictions: string[];
  corroborations: string[];
  opportunity: number;
  evidenceConfidence: number;
  commercialPriority: number;
  completionPct: number;
  deepDiveTier: "STANDARD" | "TOP_500" | "TOP_100";
}
