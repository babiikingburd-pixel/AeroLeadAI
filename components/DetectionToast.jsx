"use client";
import { useEffect, useRef, useState } from "react";
import { onDetectionToast } from "../lib/detectionToast";
import { HUD } from "../lib/hudTheme";

const DISMISS_MS = 5000;

export default function DetectionToast() {
  const [toast, setToast] = useState(null);
  const timerRef = useRef(null);

  useEffect(() => {
    return onDetectionToast((detail) => {
      clearTimeout(timerRef.current);
      setToast({ ...detail, key: Date.now() });
      timerRef.current = setTimeout(() => setToast(null), DISMISS_MS);
    });
  }, []);

  if (!toast) return null;

  return (
    <div
      key={toast.key}
      style={{
        position: "fixed", top: 70, right: 24, zIndex: 200, width: 280,
        background: "rgba(6,10,18,0.92)", border: `1px solid ${HUD.red}`, borderRadius: 8, padding: "12px 14px",
        boxShadow: `0 0 24px rgba(255,59,92,0.3), 0 12px 30px rgba(0,0,0,0.6)`,
        fontFamily: HUD.fontMono, animation: "aerolead-toast-in 0.4s cubic-bezier(.2,1,.3,1)",
      }}
    >
      <style>{`@keyframes aerolead-toast-in { from { transform: translateX(120%); opacity: 0; } to { transform: translateX(0); opacity: 1; } }`}</style>
      <div style={{ fontSize: 9.5, color: HUD.red, letterSpacing: "0.12em", fontWeight: 700 }}>▲ HIGH-VALUE TARGET ACQUIRED</div>
      <div style={{ fontFamily: HUD.fontDisplay, fontSize: 13, fontWeight: 600, margin: "4px 0 2px", color: HUD.ice }}>{toast.title}</div>
      {toast.subtitle && <div style={{ fontSize: 10.5, color: HUD.muted }}>{toast.subtitle}</div>}
    </div>
  );
}
