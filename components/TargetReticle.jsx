"use client";
import { HUD } from "../lib/hudTheme";

// Target-lock reticle — decorative emphasis for whichever property is
// currently selected/inspected. Purely visual, no interaction.
export default function TargetReticle({ label, size = 110 }) {
  return (
    <div style={{ position: "relative", width: size, height: size, flexShrink: 0 }}>
      <div style={{ position: "absolute", inset: 0, border: `1.5px solid ${HUD.red}`, borderRadius: "50%", animation: "aerolead-reticle-spin 6s linear infinite" }} />
      <div style={{ position: "absolute", inset: size * 0.17, border: "1px solid rgba(255,59,92,0.5)", borderRadius: "50%" }} />
      <style>{`
        @keyframes aerolead-reticle-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
      {label && (
        <div style={{
          position: "absolute", top: "100%", left: "50%", transform: "translateX(-50%)", marginTop: 8,
          fontFamily: HUD.fontDisplay, fontSize: 10, color: HUD.red, whiteSpace: "nowrap",
          textShadow: "0 0 8px rgba(255,59,92,0.7)", letterSpacing: "0.08em",
        }}>
          {label}
        </div>
      )}
    </div>
  );
}
