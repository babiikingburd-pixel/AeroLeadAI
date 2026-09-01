import type { EvidenceProvider, ParcelContext } from "../contracts";
import { makeEvidence } from "../evidence";
import { HttpJsonEvidenceProvider } from "./httpJson";
import { UspsAddressEvidenceProvider } from "./usps";

const rows = (body: unknown): Record<string, unknown>[] => Array.isArray(body) ? body as Record<string, unknown>[] : Array.isArray((body as any)?.results) ? (body as any).results : body && typeof body === "object" ? [body as Record<string, unknown>] : [];
const dateValue = (row: Record<string, unknown>, keys: string[]) => keys.map(k => row[k]).find(v => typeof v === "string") as string | undefined;

export function createEvidenceProviders(): EvidenceProvider[] {
  return [
    new UspsAddressEvidenceProvider(),
    new HttpJsonEvidenceProvider("assessor", "STRUCTURE", process.env.OVERSIGHT_ASSESSOR_URL_TEMPLATE, (body, parcel, sourceRef) => rows(body).map(row => makeEvidence({
      parcelId: parcel.parcelId, type: "STRUCTURE", provider: "assessor", reality: "REAL_NOW", sourceRef,
      confidence: Number(row.confidence ?? 0.9), effectiveAt: dateValue(row, ["updated_at", "effective_at"]), payload: row,
    }))),
    new HttpJsonEvidenceProvider("permit_registry", "PERMIT", process.env.OVERSIGHT_PERMIT_URL_TEMPLATE, (body, parcel, sourceRef) => rows(body).map(row => makeEvidence({
      parcelId: parcel.parcelId, type: "PERMIT", provider: "permit_registry", reality: "REAL_NOW", sourceRef,
      confidence: Number(row.confidence ?? 0.95), effectiveAt: dateValue(row, ["issued_date", "issue_date", "date"]), payload: row,
    }))),
    new HttpJsonEvidenceProvider("noaa_storm_events", "WEATHER", process.env.OVERSIGHT_NOAA_URL_TEMPLATE, (body, parcel, sourceRef) => rows(body).map(row => makeEvidence({
      parcelId: parcel.parcelId, type: "WEATHER", provider: "noaa_storm_events", reality: "REAL_NOW", sourceRef,
      confidence: Number(row.confidence ?? 0.85), effectiveAt: dateValue(row, ["begin_date_time", "event_date", "date"]), payload: row,
    }))),
    new HttpJsonEvidenceProvider("imagery_analysis", "IMAGERY", process.env.OVERSIGHT_IMAGERY_URL_TEMPLATE, (body, parcel, sourceRef) => rows(body).map(row => makeEvidence({
      parcelId: parcel.parcelId, type: "IMAGERY", provider: "imagery_analysis", reality: "REAL_NOW", sourceRef,
      confidence: Number(row.confidence ?? 0), effectiveAt: dateValue(row, ["captured_at", "image_date", "date"]), payload: row,
    })), process.env.OVERSIGHT_IMAGERY_API_KEY ? { Authorization: `Bearer ${process.env.OVERSIGHT_IMAGERY_API_KEY}` } : {}),
  ];
}

export type { EvidenceProvider, ParcelContext };
