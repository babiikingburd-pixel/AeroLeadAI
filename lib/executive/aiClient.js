import { callTextModel, activeProvider } from "../aiClient";

// Wraps the app's own Groq/Anthropic auto-selecting client so the ported
// executive-engine agents (which expect a `.complete({system, messages,
// temperature, max_tokens})` interface) run on whichever provider is already
// configured for the rest of AeroLeadAI — no separate ANTHROPIC_API_KEY-only
// client, no second vendor decision.
export function createExecutiveAIClient() {
  return {
    async complete({ system, messages, temperature = 0, max_tokens = 800 }) {
      const prompt = (messages || []).map((m) => m.content).join("\n\n");
      const { text } = await callTextModel({ prompt, system, maxTokens: max_tokens, temperature });
      return text;
    },
  };
}

export { activeProvider };
