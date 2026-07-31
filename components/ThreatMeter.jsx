"use client";
import { HUD, threatColor } from "../lib/hudTheme";

const SEGMENTS = 10;

// Segmented score bar matching the tactical HUD reference — filled segments
// use the amber->red gradient regardless of actual tier color (that's the
// reference's own convention: the meter always reads as "threat", while the
// numeric score keeps its tier color).
export default function ThreatMeter({ label = "THREAT LEVEL", score }) {
  const filled = score === null || score === undefined ? 0 : Math.round((score / 100) * SEGMENTS);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 5 }}>
        <span style={{ fontFamily: HUD.fontDisplay, fontWeight: 600, letterSpacing: "0.05em", color: HUD.ice }}>{label}</span>
        <span style={{ color: threatColor(score), fontWeight: 700, textShadow: "0 0 8px rgba(255,59,92,0.4)" }}>
          {score === null || score === undefined ? "—" : `${score} / 100`}
        </span>
      </div>
      <div style={{ display: "flex", gap: 2, height: 16 }}>
        {Array.from({ length: SEGMENTS }).map((_, i) => (
          <div
            key={i}
            style={{
              flex: 1,
              background: i < filled ? `linear-gradient(90deg, ${HUD.amber}, ${HUD.red})` : "rgba(255,255,255,0.06)",
              boxShadow: i < filled ? "0 0 10px rgba(255,59,92,0.5)" : "none",
              clipPath: "polygon(6px 0, 100% 0, calc(100% - 6px) 100%, 0 100%)",
            }}
          />
        ))}
      </div>
    </div>
  );
}
