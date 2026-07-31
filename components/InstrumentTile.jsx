"use client";
import { HUD } from "../lib/hudTheme";

// Tactical-HUD image tile. `active` = full opacity/scale, brought forward.
// Minimized (the default for everything but the active tile) dims and
// desaturates instead of hiding — it stays mounted and clickable so the
// operator never loses the image, only a click on the × (onRetract) removes
// it from the stack entirely. This is the one place a tile actually
// disappears; minimizing never does.
export default function InstrumentTile({ tag, src, active, onActivate, onRetract, width = 160, height = 130 }) {
  return (
    <div
      onClick={onActivate}
      style={{
        position: "relative", width, height, borderRadius: 6, overflow: "hidden",
        border: `1px solid ${active ? HUD.line : HUD.lineDim}`,
        background: "#0a1120", cursor: onActivate ? "pointer" : "default",
        transition: "opacity .35s ease, filter .35s ease, transform .35s ease",
        opacity: active ? 1 : 0.35,
        filter: active ? "contrast(1.08) saturate(1.05)" : "saturate(0.3) brightness(0.65)",
        transform: active ? "scale(1)" : "scale(0.94)",
        boxShadow: active
          ? "0 0 0 1px rgba(95,224,255,0.3), 0 0 24px rgba(95,224,255,0.15), 0 12px 30px rgba(0,0,0,0.5)"
          : "0 0 0 1px rgba(95,224,255,0.06)",
      }}
    >
      <img src={src} alt={tag} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
      <span
        style={{
          position: "absolute", top: 6, left: 8, fontSize: 9.5, letterSpacing: "0.08em", color: HUD.cyan,
          background: "rgba(3,5,10,0.65)", padding: "2px 6px", borderRadius: 3,
        }}
      >
        {tag}{active ? " · ACTIVE" : ""}
      </span>
      {onRetract && (
        <button
          onClick={(e) => { e.stopPropagation(); onRetract(); }}
          title="Retract — remove from stack"
          style={{
            position: "absolute", top: 4, right: 4, width: 18, height: 18, borderRadius: 4,
            background: "rgba(3,5,10,0.7)", border: `1px solid ${HUD.lineDim}`, color: HUD.muted,
            fontSize: 11, lineHeight: "16px", cursor: "pointer", padding: 0,
          }}
        >
          ×
        </button>
      )}
    </div>
  );
}
