"use client";
import { useRef, useState } from "react";

// Historical imagery comparison — a draggable before/after slider. Pure
// CSS/JS, no dependency. Shows the honest "not available" message when no
// historical-capable provider (Planet/Sentinel) is configured, rather than
// faking a comparison with same-date imagery.
export default function ImageryCompare({ current, historical }) {
  const [pos, setPos] = useState(50);
  const wrapRef = useRef(null);

  if (!historical?.available) {
    return (
      <div style={{ padding: 14, background: "#141b26", border: "1px solid #232f3e", borderRadius: 8, fontSize: 12, color: "#6b7c93" }}>
        📅 Historical comparison unavailable — {historical?.providersNote || "no historical-capable imagery provider configured."}
      </div>
    );
  }

  function onMove(e) {
    const rect = wrapRef.current.getBoundingClientRect();
    const x = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left;
    setPos(Math.min(100, Math.max(0, (x / rect.width) * 100)));
  }

  return (
    <div>
      <div ref={wrapRef} onMouseMove={(e) => e.buttons === 1 && onMove(e)} onTouchMove={onMove}
        style={{ position: "relative", width: "100%", aspectRatio: "1", borderRadius: 8, overflow: "hidden", cursor: "ew-resize", userSelect: "none", border: "1px solid #232f3e" }}>
        <img src={current} alt="current" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />
        <div style={{ position: "absolute", inset: 0, width: `${pos}%`, overflow: "hidden" }}>
          <img src={historical.imageUrl || current} alt="historical" style={{ width: `${100 * (100 / pos || 1)}%`, maxWidth: "none", height: "100%", objectFit: "cover" }} />
        </div>
        <div style={{ position: "absolute", top: 0, bottom: 0, left: `${pos}%`, width: 2, background: "#f5a623" }} />
        <div style={{ position: "absolute", top: "50%", left: `${pos}%`, transform: "translate(-50%,-50%)", width: 28, height: 28, borderRadius: "50%", background: "#f5a623", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, color: "#1a1200", fontWeight: 700 }}>⇔</div>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#6b7c93", marginTop: 6 }}>
        <span>{historical.oldestDate ? new Date(historical.oldestDate).toLocaleDateString() : "Historical"}</span>
        <span>{historical.newestDate ? new Date(historical.newestDate).toLocaleDateString() : "Current"}</span>
      </div>
    </div>
  );
}
