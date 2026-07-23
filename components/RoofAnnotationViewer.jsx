"use client";
import { useRef, useEffect, useState } from "react";

const SEVERITY_COLOR = { minor: "#eab308", moderate: "#f97316", severe: "#dc2626" };

// Draws AI-detected damage bounding boxes (normalized 0-1 coords from
// /api/damage-annotate) over the actual image on a canvas overlay — click a
// box to see the model's description. Complements the single concern-score
// from /api/damage-agent with a visual "here's specifically what it saw."
export default function RoofAnnotationViewer({ imageUrl, damage = [], confidence }) {
  const canvasRef = useRef(null);
  const imgRef = useRef(null);
  const [selected, setSelected] = useState(null);
  const [imgLoaded, setImgLoaded] = useState(false);

  useEffect(() => {
    if (!imgLoaded) return;
    const canvas = canvasRef.current, img = imgRef.current;
    if (!canvas || !img) return;
    const ctx = canvas.getContext("2d");
    canvas.width = img.clientWidth;
    canvas.height = img.clientHeight;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    damage.forEach((d, i) => {
      const { x, y, width, height } = d.bounding_box || {};
      if ([x, y, width, height].some((v) => typeof v !== "number")) return;
      const px = x * canvas.width, py = y * canvas.height, pw = width * canvas.width, ph = height * canvas.height;
      const color = SEVERITY_COLOR[d.severity] || "#f97316";

      ctx.strokeStyle = color;
      ctx.lineWidth = selected === i ? 3 : 2;
      ctx.strokeRect(px, py, pw, ph);

      ctx.fillStyle = color;
      ctx.font = "bold 12px sans-serif";
      const label = `${(d.type || "damage").replace(/_/g, " ")} (${Math.round((d.confidence || 0) * 100)}%)`;
      const textWidth = ctx.measureText(label).width;
      ctx.fillRect(px, Math.max(0, py - 16), textWidth + 8, 16);
      ctx.fillStyle = "#fff";
      ctx.fillText(label, px + 4, Math.max(12, py - 4));
    });
  }, [imgLoaded, damage, selected]);

  function handleClick(e) {
    const rect = canvasRef.current.getBoundingClientRect();
    const cx = (e.clientX - rect.left) / rect.width;
    const cy = (e.clientY - rect.top) / rect.height;
    const hitIdx = damage.findIndex((d) => {
      const { x, y, width, height } = d.bounding_box || {};
      return cx >= x && cx <= x + width && cy >= y && cy <= y + height;
    });
    setSelected(hitIdx === -1 ? null : hitIdx);
  }

  return (
    <div style={{ position: "relative", display: "inline-block", maxWidth: 480, width: "100%" }}>
      <img
        ref={imgRef} src={imageUrl} alt="Satellite roof imagery" onLoad={() => setImgLoaded(true)}
        style={{ width: "100%", borderRadius: 8, border: "1px solid #232f3e", display: "block" }}
      />
      <canvas ref={canvasRef} onClick={handleClick} style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", cursor: damage.length ? "pointer" : "default" }} />
      <div style={{ marginTop: 8, display: "flex", justifyContent: "space-between", fontSize: 12, color: "#6b7c93" }}>
        <span>{damage.length} issue{damage.length !== 1 ? "s" : ""} detected</span>
        <span>Confidence: {Math.round((confidence || 0) * 100)}%</span>
      </div>
      {selected !== null && damage[selected] && (
        <div style={{ marginTop: 8, padding: 10, borderRadius: 8, background: "#141b26", border: "1px solid #232f3e", fontSize: 13 }}>
          <div style={{ fontWeight: 700, textTransform: "capitalize" }}>{(damage[selected].type || "").replace(/_/g, " ")} — {damage[selected].severity}</div>
          <div style={{ color: "#6b7c93", marginTop: 4 }}>{damage[selected].description}</div>
        </div>
      )}
    </div>
  );
}
