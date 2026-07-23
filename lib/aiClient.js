// Provider auto-selection: if ANTHROPIC_API_KEY is set, use Claude (best
// quality). Otherwise, if GROQ_API_KEY is set, use Groq's free vision model.
// This means: run on Groq for free today, add ANTHROPIC_API_KEY tomorrow,
// redeploy — every route silently upgrades to Claude with zero code edits.

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const GROQ_KEY = process.env.GROQ_API_KEY;

export function activeProvider() {
  if (ANTHROPIC_KEY) return "anthropic";
  if (GROQ_KEY) return "groq";
  return null;
}

export async function callVisionModel({ base64Image, mediaType, prompt, images }) {
  const provider = activeProvider();
  // Normalize: accept either the old single-image shape or a new images array
  // [{ base64Image, mediaType }, ...] so callers can send the full multi-angle
  // sweep in one request instead of scoring each shot separately and blind to
  // the others.
  const imgList = images && images.length ? images : [{ base64Image, mediaType }];

  if (provider === "anthropic") {
    const content = [
      ...imgList.map((im) => ({ type: "image", source: { type: "base64", media_type: im.mediaType || "image/jpeg", data: im.base64Image } })),
      { type: "text", text: prompt },
    ];
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: 800, temperature: 0, messages: [{ role: "user", content }] }),
    });
    if (!res.ok) throw new Error("Anthropic API error: " + (await res.text()));
    const data = await res.json();
    return { text: (data.content || []).map((b) => b.text || "").join("\n"), provider };
  }

  if (provider === "groq") {
    // meta-llama/llama-4-scout-17b-16e-instruct was deprecated by Groq — this
    // is why damage scoring was failing with "model does not exist". Current
    // vision-capable model is qwen/qwen3.6-27b (as of mid-2026). Groq also
    // caps requests at 5 images, so trim the sweep instead of erroring.
    const capped = imgList.slice(0, 5);
    const content = [
      { type: "text", text: prompt },
      ...capped.map((im) => ({ type: "image_url", image_url: { url: `data:${im.mediaType || "image/jpeg"};base64,${im.base64Image}` } })),
    ];
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${GROQ_KEY}` },
      body: JSON.stringify({ model: "qwen/qwen3.6-27b", temperature: 0, messages: [{ role: "user", content }] }),
    });
    if (!res.ok) throw new Error("Groq API error: " + (await res.text()));
    const data = await res.json();
    return { text: data.choices?.[0]?.message?.content || "", provider };
  }

  throw new Error("No AI provider configured. Set GROQ_API_KEY (free, no card) or ANTHROPIC_API_KEY.");
}

export async function callTextModel({ prompt, system, maxTokens = 400, temperature = 0 }) {
  const provider = activeProvider();

  if (provider === "anthropic") {
    const body = { model: "claude-sonnet-4-6", max_tokens: maxTokens, temperature, messages: [{ role: "user", content: prompt }] };
    if (system) body.system = system;
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error("Anthropic API error: " + (await res.text()));
    const data = await res.json();
    return { text: (data.content || []).map((b) => b.text || "").join("\n"), provider };
  }

  if (provider === "groq") {
    // llama-3.3-70b-versatile was also deprecated by Groq — migrated to
    // openai/gpt-oss-120b per Groq's official migration guidance.
    const messages = system ? [{ role: "system", content: system }, { role: "user", content: prompt }] : [{ role: "user", content: prompt }];
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${GROQ_KEY}` },
      body: JSON.stringify({ model: "openai/gpt-oss-120b", temperature, messages }),
    });
    if (!res.ok) throw new Error("Groq API error: " + (await res.text()));
    const data = await res.json();
    return { text: data.choices?.[0]?.message?.content || "", provider };
  }

  throw new Error("No AI provider configured. Set GROQ_API_KEY (free, no card) or ANTHROPIC_API_KEY.");
}
