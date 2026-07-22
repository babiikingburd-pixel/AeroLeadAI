// Pushes leads to HubSpot and/or Salesforce via configured webhook/inbound
// endpoints. Secrets live ONLY in env vars. If neither is configured, the
// route says so honestly instead of pretending it synced.
export async function POST(req) {
  const { leads } = await req.json();
  if (!Array.isArray(leads) || leads.length === 0 || leads.length > 500) {
    return Response.json({ ok: false, error: "Provide 1-500 leads." }, { status: 400 });
  }

  const hubspot = process.env.HUBSPOT_WEBHOOK_URL;
  const salesforce = process.env.SALESFORCE_WEBHOOK_URL;
  if (!hubspot && !salesforce) {
    return Response.json({ ok: false, error: "No CRM configured. Set HUBSPOT_WEBHOOK_URL and/or SALESFORCE_WEBHOOK_URL in env vars. CSV export works without any setup." });
  }

  const payload = leads.map((l) => ({
    address: String(l.address || "").slice(0, 300),
    damage_score: l.findingsScore ?? null,
    ai_confidence: l.confidence || null,
    status: l.status || "new",
    estimated_value: l.estValue ?? null,
    lat: l.lat ?? null, lon: l.lon ?? null,
    source: "AeroLeadAI",
  }));

  const results = {};
  for (const [name, url] of [["hubspot", hubspot], ["salesforce", salesforce]]) {
    if (!url) continue;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leads: payload }),
      });
      results[name] = res.ok ? "synced" : `HTTP ${res.status}`;
    } catch (e) {
      results[name] = "failed: " + e.message;
    }
  }
  return Response.json({ ok: true, count: payload.length, results });
}
