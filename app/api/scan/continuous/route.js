import { saveLeadToDB } from "../../../../lib/supabase";
export const dynamic = "force-dynamic";

export const maxDuration = 45;

const BATCH_PACE_MS = 2500; // free-tier rate limit protection between batches

async function callClaude(zipCode, count) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not configured.");

  const prompt = `Generate ${count} realistic but fictional residential lead records for roofing/exterior sales prospecting in ZIP code ${zipCode}. Return ONLY a JSON array, no prose, of objects with this exact shape:
[{"address": "123 Main St, City, ST 00000", "city": "City", "zip": "${zipCode}", "roof_score": 0-100, "drive_score": 0-100, "landscape_score": 0-100, "urgency": "low|medium|high", "est_value": "$X,XXX", "damage_notes": "short note", "home_age": 1-80, "sqft": 800-6000, "lat": 0.0, "lng": 0.0}]`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 2000,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Anthropic API error ${res.status}: ${text}`);
  }

  const data = await res.json();
  const text = data.content?.[0]?.text ?? "[]";
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  return JSON.parse(jsonMatch ? jsonMatch[0] : text);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function POST(req) {
  try {
    const body = await req.json();
    const zipCode = (body.zipCode || "").trim();
    const batchSize = Math.min(Math.max(parseInt(body.batchSize, 10) || 4, 1), 10);

    if (!zipCode) {
      return Response.json({ success: false, error: "zipCode is required." }, { status: 400 });
    }

    const generated = await callClaude(zipCode, batchSize);

    const saved = [];
    for (const lead of generated) {
      saved.push(await saveLeadToDB(lead));
      await sleep(BATCH_PACE_MS);
    }

    return Response.json({ success: true, leads: saved, scannedAt: new Date().toISOString() });
  } catch (e) {
    return Response.json({ success: false, error: e.message }, { status: 500 });
  }
}
