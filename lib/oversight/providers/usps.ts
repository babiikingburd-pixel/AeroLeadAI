import type { EvidenceProvider, ParcelContext } from "../contracts";
import { makeEvidence, unavailable } from "../evidence";

let tokenCache: { token: string; expiresAt: number } | null = null;

async function oauthToken(signal?: AbortSignal) {
  if (tokenCache && tokenCache.expiresAt > Date.now() + 60_000) return tokenCache.token;
  const clientId = process.env.USPS_CLIENT_ID;
  const clientSecret = process.env.USPS_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  const response = await fetch("https://apis.usps.com/oauth2/v3/token", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, grant_type: "client_credentials" }),
    signal,
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`usps_oauth_http_${response.status}`);
  const body = await response.json();
  if (!body?.access_token) throw new Error("usps_oauth_missing_token");
  tokenCache = { token: body.access_token, expiresAt: Date.now() + Number(body.expires_in || 3600) * 1000 };
  return tokenCache.token;
}

function addressParts(parcel: ParcelContext) {
  const parts = parcel.address.split(",").map(x => x.trim()).filter(Boolean);
  const streetAddress = parts[0] || parcel.address;
  const city = parts.length >= 2 ? parts[1] : "";
  const state = parcel.state || (parts.length >= 3 ? parts[2].slice(0, 2) : "MN");
  return { streetAddress, city, state, ZIPCode: parcel.zip || "" };
}

export class UspsAddressEvidenceProvider implements EvidenceProvider {
  readonly name = "usps_addresses_v3";
  readonly type = "PROPERTY" as const;

  async collect(parcel: ParcelContext, signal?: AbortSignal) {
    try {
      const token = await oauthToken(signal);
      if (!token) return [unavailable(parcel.parcelId, this.type, this.name, "provider_not_configured")];
      const p = addressParts(parcel);
      const query = new URLSearchParams({ streetAddress: p.streetAddress, city: p.city, state: p.state });
      if (p.ZIPCode) query.set("ZIPCode", p.ZIPCode);
      const sourceRef = `https://apis.usps.com/addresses/v3/address?${query}`;
      const response = await fetch(sourceRef, {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json", "User-Agent": "AeroLeadAI-Oversight/1.2" },
        signal,
        cache: "no-store",
      });
      if (!response.ok) return [unavailable(parcel.parcelId, this.type, this.name, `http_${response.status}`)];
      const body = await response.json();
      const address = body?.address || body;
      const additional = body?.additionalInfo || body?.additional_info || {};
      return [makeEvidence({
        parcelId: parcel.parcelId,
        type: "PROPERTY",
        provider: this.name,
        reality: "REAL_NOW",
        sourceRef,
        confidence: 0.97,
        payload: {
          standardized_address: address,
          additional_info: additional,
          usage_code: additional?.usageCode || additional?.usage_code || body?.usageCode || body?.usage_code || null,
          delivery_type: additional?.deliveryType || additional?.delivery_type || body?.deliveryType || null,
          validated_at: new Date().toISOString(),
        },
      })];
    } catch (error) {
      return [unavailable(parcel.parcelId, this.type, this.name, error instanceof Error ? error.message : "usps_request_failed")];
    }
  }
}
