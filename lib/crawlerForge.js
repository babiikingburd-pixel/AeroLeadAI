// CRAWLER FORGE — spawns a crawler run for a stated goal, but every crawler
// is a bounded call sequence against tools that ALREADY EXIST in this
// codebase (weather-agent, permit-lookup, imagery-agent, zip-scan). This is
// deliberately not a code-generation system. "Design a crawler for a
// mission" here means "pick the right existing endpoint(s) and run them
// with a real budget/domain/request cap" — not "write new scraping logic."

import { checkRunAllowed, recordRun } from "./agentFactory";
import { withCrawlerLog } from "./crawlerLog";

// Goal -> tool sequence mapping. This IS the "specialized crawler design"
// the request asked for, made honest: each goal maps to a specific,
// bounded sequence of REAL existing calls, not a new crawler class.
const MISSION_TOOL_SEQUENCES = {
  hail_damage: ["weather_api", "imagery_analysis", "damage_scoring"],
  commercial_growth: ["permit_lookup", "zip_scan"],
  storm_followup: ["weather_api", "permit_lookup"],
  permit_sweep: ["zip_scan", "permit_lookup"],
};

export async function spawnCrawler(agentId, goal, targetAddresses = [], baseUrl = "") {
  const allowed = await checkRunAllowed(agentId);
  if (!allowed.allowed) return { ok: false, error: allowed.reason };

  const sequence = MISSION_TOOL_SEQUENCES[goal];
  if (!sequence) {
    return { ok: false, error: `Unknown goal "${goal}". Known missions: ${Object.keys(MISSION_TOOL_SEQUENCES).join(", ")}. New missions require adding a real tool sequence here, not free-form generation.` };
  }

  // Respect the agent's own tool whitelist — even a valid mission sequence
  // can't use a tool this specific agent wasn't granted.
  const agentTools = allowed.agent.tools || [];
  const usableSequence = sequence.filter((t) => agentTools.includes(t));
  if (usableSequence.length === 0) {
    return { ok: false, error: `Agent's tool list (${agentTools.join(", ")}) doesn't include any tool needed for mission "${goal}" (needs: ${sequence.join(", ")}).` };
  }

  return withCrawlerLog(`crawler_${goal}`, async () => {
    let succeeded = 0, failed = 0;
    const errors = [];
    const cappedAddresses = targetAddresses.slice(0, 20); // hard per-run address cap

    for (const address of cappedAddresses) {
      for (const tool of usableSequence) {
        const stillAllowed = await checkRunAllowed(agentId);
        if (!stillAllowed.allowed) {
          errors.push(`Stopped mid-run: ${stillAllowed.reason}`);
          return { succeeded, failed, errors };
        }

        try {
          if (tool === "damage_scoring") {
            // damage_scoring is a POST route needing real image bytes — it
            // can't be dispatched the same simple way as the GET-based
            // tools. Real chain: geocode -> fetch imagery -> POST the
            // actual image to damage-agent with this agent's ID attached.
            const geoRes = await fetch(`${baseUrl}/api/geocode`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ address }) });
            const geo = await geoRes.json();
            if (!geo.ok && !geo.lat) { failed++; errors.push(`${address}: geocode failed for damage_scoring chain`); await recordRun(agentId, tool, 0, "failed", `${address}: no coordinates`); continue; }

            const imgRes = await fetch(`${baseUrl}/api/imagery-agent`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ lat: geo.lat, lon: geo.lon }) });
            const img = await imgRes.json();
            if (!img.dataUrl) { failed++; errors.push(`${address}: no imagery available for damage_scoring chain`); await recordRun(agentId, tool, 0, "failed", `${address}: no imagery`); continue; }

            const match = img.dataUrl.match(/^data:(image\/[a-zA-Z+]+);base64,(.*)$/);
            const scoreRes = await fetch(`${baseUrl}/api/damage-agent`, {
              method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ domain: "roof", base64Image: match?.[2], mediaType: match?.[1], address, agentId }),
            });
            const cost = 0.02; // real vision call, costs more than a lookup — reflected honestly
            await recordRun(agentId, tool, cost, scoreRes.ok ? "success" : "failed", `${tool} for ${address}: HTTP ${scoreRes.status}`);
            if (scoreRes.ok) succeeded++; else failed++;
            continue;
          }

          const toolInfo = { weather_api: "/api/weather-agent", permit_lookup: "/api/permit-lookup", imagery_analysis: "/api/imagery-agent", zip_scan: "/api/zip-scan" }[tool];
          const url = `${baseUrl}${toolInfo}?address=${encodeURIComponent(address)}`;
          const res = await fetch(url);
          const cost = 0.001; // nominal per-call cost tracking for lookup-style tools
          await recordRun(agentId, tool, cost, res.ok ? "success" : "failed", `${tool} for ${address}: HTTP ${res.status}`);
          if (res.ok) succeeded++; else failed++;
        } catch (e) {
          await recordRun(agentId, tool, 0, "failed", `${tool} for ${address}: ${e.message}`);
          failed++;
          errors.push(`${address} (${tool}): ${e.message}`);
        }
      }
    }

    return { succeeded, failed, errors };
  });
}

export function availableMissions() {
  return Object.entries(MISSION_TOOL_SEQUENCES).map(([goal, tools]) => ({ goal, tools }));
}
