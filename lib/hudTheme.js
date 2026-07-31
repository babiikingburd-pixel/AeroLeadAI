// Shared tactical-HUD design tokens — matches the aeroleadaitactical.html
// reference exactly (same hex values) so every component drawing from this
// file stays visually consistent instead of each one guessing its own palette.
export const HUD = {
  bg: "#03050a",
  line: "rgba(120,200,255,0.28)",
  lineDim: "rgba(120,200,255,0.10)",
  cyan: "#5fe0ff",
  amber: "#ff8a4a",
  red: "#ff3b5c",
  green: "#3ddc97",
  ice: "#d8ecff",
  muted: "#5b7191",
  fontMono: "'JetBrains Mono', monospace",
  fontDisplay: "'Chakra Petch', sans-serif",
};

export function threatColor(score) {
  if (score === null || score === undefined) return HUD.muted;
  if (score >= 75) return HUD.red;
  if (score >= 50) return HUD.amber;
  if (score >= 25) return HUD.cyan;
  return HUD.green;
}
