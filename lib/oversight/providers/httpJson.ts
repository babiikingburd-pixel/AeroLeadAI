import type { EvidenceProvider, EvidenceType, ParcelContext } from "../contracts";
import { makeEvidence, unavailable } from "../evidence";

export type JsonNormalizer = (body: unknown, parcel: ParcelContext, sourceRef: string) => ReturnType<typeof makeEvidence>[];

export class HttpJsonEvidenceProvider implements EvidenceProvider {
  constructor(
    public readonly name: string,
    public readonly type: EvidenceType,
    private readonly template: string | undefined,
    private readonly normalize: JsonNormalizer,
    private readonly headers: Record<string, string> = {},
  ) {}

  async collect(parcel: ParcelContext, signal?: AbortSignal) {
    if (!this.template) return [unavailable(parcel.parcelId, this.type, this.name, "provider_not_configured")];
    const values: Record<string, string> = {
      parcelId: parcel.parcelId, address: parcel.address, lat: String(parcel.latitude ?? ""),
      lon: String(parcel.longitude ?? ""), zip: parcel.zip || "", county: parcel.county || "", state: parcel.state || "",
    };
    const url = this.template.replace(/\{(parcelId|address|lat|lon|zip|county|state)\}/g, (_, key) => encodeURIComponent(values[key]));
    try {
      const response = await fetch(url, { signal, headers: { Accept: "application/json", "User-Agent": "AeroLeadAI-Oversight/1.1", ...this.headers }, cache: "no-store" });
      if (!response.ok) return [unavailable(parcel.parcelId, this.type, this.name, `http_${response.status}`)];
      return this.normalize(await response.json(), parcel, url);
    } catch (error) {
      return [unavailable(parcel.parcelId, this.type, this.name, error instanceof Error ? error.message : "provider_request_failed")];
    }
  }
}
