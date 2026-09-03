import type { SupabaseClient } from "@supabase/supabase-js";
import type { EvidenceRecord } from "./contracts";

const toRow = (r: EvidenceRecord) => ({
  id: r.id, parcel_id: r.parcelId, type: r.type, provider: r.provider, reality: r.reality,
  captured_at: r.capturedAt, effective_at: r.effectiveAt || null, source_ref: r.sourceRef || null,
  content_hash: r.contentHash || null, confidence: r.confidence, payload: r.payload,
});
const fromRow = (r: any): EvidenceRecord => ({
  id: r.id, parcelId: r.parcel_id, type: r.type, provider: r.provider, reality: r.reality,
  capturedAt: r.captured_at, effectiveAt: r.effective_at || undefined, sourceRef: r.source_ref || undefined,
  contentHash: r.content_hash || undefined, confidence: Number(r.confidence), payload: r.payload || {},
});

export class SupabaseEvidenceCache {
  constructor(private readonly db: SupabaseClient) {}
  async persist(records: EvidenceRecord[]) {
    if (!records.length) return;
    const { error } = await this.db.from("evidence_records").upsert(records.map(toRow), { onConflict: "id" });
    if (error) throw new Error(`evidence_cache_write_failed: ${error.message}`);
  }
  async list(parcelId: string, limit = 500) {
    const { data, error } = await this.db.from("evidence_records").select("*").eq("parcel_id", parcelId).order("captured_at", { ascending: false }).limit(limit);
    if (error) throw new Error(`evidence_cache_read_failed: ${error.message}`);
    return (data || []).map(fromRow);
  }
}
