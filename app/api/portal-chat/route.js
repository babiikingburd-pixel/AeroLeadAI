import { callTextModel, activeProvider } from "../../../lib/aiClient";
import { isValidAddress } from "../../../lib/validate";

// Customer Portal AI chat — grounded in that specific job's real data
// (address, damage findings, status, estimate) so it can't invent details
// about a property it hasn't seen. No conversation memory beyond what the
// client sends back each turn (stateless route, same pattern as the rest
// of this app's AI calls).
export async function POST(req) {
  try {
    const { message, history, job } = await req.json();
    if (!isValidAddress(job?.address)) return Response.json({ error: "Valid job context required." }, { status: 400 });
    if (typeof message !== "string" || !message.trim() || message.length > 1000) {
      return Response.json({ error: "Valid message required (max 1000 chars)." }, { status: 400 });
    }
    if (!activeProvider()) {
      return Response.json({ error: "No AI provider configured. Set GROQ_API_KEY (free) or ANTHROPIC_API_KEY." }, { status: 500 });
    }

    const context = `Property: ${job.address}
Job status: ${job.status || "not yet scheduled"}
AI damage score (0-100, if scored): ${job.findings_score ?? "not yet scored"}
Estimated cost: ${job.revenue_estimate ? `$${job.revenue_estimate}` : "not yet estimated"}
Scheduled date: ${job.scheduled_date || "not yet scheduled"}
Assigned contractor: ${job.contractors?.name || "not yet assigned"}`;

    const recentHistory = (history || []).slice(-6).map((h) => `${h.role === "user" ? "Customer" : "Assistant"}: ${h.text}`).join("\n");

    const prompt = `You are a helpful, honest customer-service assistant for AeroLeadAI, a roofing lead/inspection company.
You are answering a HOMEOWNER's question about their own property in this portal. Only use the facts given below —
never invent scheduling, pricing, or contractor details that aren't provided. If something isn't known yet, say so
plainly and suggest they check back or contact the office. Keep answers short (2-4 sentences), warm, and direct.

${context}

${recentHistory ? `Recent conversation:\n${recentHistory}\n` : ""}
Customer: ${message.trim()}

Respond with plain text only, no JSON, no markdown.`;

    const { text, provider } = await callTextModel({ prompt });
    return Response.json({ reply: text.trim(), provider });
  } catch (e) {
    return Response.json({ error: e?.message || "Unknown server error" }, { status: 500 });
  }
}
