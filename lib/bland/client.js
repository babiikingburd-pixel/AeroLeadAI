// Outbound Bland AI call placement. Gated behind BLAND_API_KEY +
// BLAND_QUALIFY_PATHWAY_ID, same {available:false, reason} pattern as
// lib/financial/financialServices.js — real code, inert until you've
// created a Bland account and imported lib/bland/pathway.json.
export async function placeQualifyCall(lead) {
  const apiKey = process.env.BLAND_API_KEY;
  const pathwayId = process.env.BLAND_QUALIFY_PATHWAY_ID;
  if (!apiKey || !pathwayId) {
    return { available: false, reason: "BLAND_API_KEY / BLAND_QUALIFY_PATHWAY_ID not configured — see README for setup." };
  }
  if (!lead.phone) {
    return { available: false, reason: "Lead has no phone number." };
  }

  const base = (process.env.APP_BASE_URL || "").replace(/\/$/, "");
  const body = {
    phone_number: lead.phone,
    pathway_id: pathwayId,
    metadata: { lead_id: lead.id },
    request_data: {
      agent_name: "AeroLeadAI",
      address: lead.address,
      proposed_time_1: "tomorrow morning",
      proposed_time_2: "tomorrow afternoon",
    },
  };
  if (base) body.webhook = `${base}/api/bland/webhook`;

  const res = await fetch("https://api.bland.ai/v1/calls", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: apiKey },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    return { available: true, success: false, error: `Bland API error: ${res.status} ${await res.text()}` };
  }
  const data = await res.json();
  return { available: true, success: true, call_id: data.call_id };
}
