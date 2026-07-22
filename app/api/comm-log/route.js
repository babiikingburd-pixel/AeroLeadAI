export async function POST(req) {
  const { channel, to, address, summary } = await req.json();
  if (!["email", "sms"].includes(channel)) return Response.json({ ok: false, error: "channel must be 'email' or 'sms'." }, { status: 400 });

  const url = channel === "email" ? process.env.EMAIL_WEBHOOK_URL : process.env.SMS_WEBHOOK_URL;
  if (!url) return Response.json({ ok: true, sent: false, note: `No ${channel.toUpperCase()}_WEBHOOK_URL configured — logged locally only.` });

  try {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ to, address, summary }) });
    return Response.json({ ok: res.ok, sent: res.ok, note: res.ok ? "Sent." : `Webhook HTTP ${res.status}` });
  } catch (e) {
    return Response.json({ ok: false, sent: false, note: "Send failed: " + e.message });
  }
}
