"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import DetectionToast from "./DetectionToast";
import { HUD } from "../lib/hudTheme";

const MODULES = [
  { href: "/", label: "Console" },
  { href: "/discovery", label: "Discovery" },
  { href: "/batch", label: "Batch / Mass Upload" },
  { href: "/map", label: "Lead Map" },
  { href: "/scanner", label: "Background Scanner" },
  { href: "/jobs", label: "Jobs" },
  { href: "/dashboard", label: "Dashboard" },
  { href: "/crm", label: "CRM" },
  { href: "/ops", label: "Ops Center" },
  { href: "/intelligence", label: "Intelligence" },
  { href: "/enterprise", label: "Enterprise" },
  { href: "/executive", label: "Executive" },
];

export default function TacticalShell({ children }) {
  const pathname = usePathname();

  // Customer Portal is homeowner-facing — no internal nav chrome there,
  // same exclusion ConditionalTopNav used to apply.
  if (pathname?.startsWith("/portal/")) return children;

  return <ShellChrome pathname={pathname}>{children}</ShellChrome>;
}

function ShellChrome({ pathname, children }) {
  const [health, setHealth] = useState(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/system-health")
      .then((r) => r.json())
      .then((data) => { if (!cancelled) setHealth(data); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const okCount = health?.checks?.filter((c) => c.ok).length ?? null;
  const totalCount = health?.checks?.length ?? null;

  return (
    <div style={{ position: "relative", minHeight: "100vh", background: HUD.bg, fontFamily: HUD.fontMono, color: HUD.ice }}>
      <div style={{ position: "fixed", inset: 0, zIndex: 90, pointerEvents: "none", boxShadow: "inset 0 0 160px 40px rgba(0,0,0,0.85)" }} />
      <div
        style={{
          position: "fixed", inset: 0, zIndex: 89, pointerEvents: "none", opacity: 0.25,
          background: "repeating-linear-gradient(0deg, rgba(0,0,0,0.25) 0px, transparent 1px, transparent 3px)",
          animation: "aerolead-scandrift 9s linear infinite",
        }}
      />
      <style>{`@keyframes aerolead-scandrift { from { background-position-y: 0; } to { background-position-y: 200px; } }`}</style>

      <DetectionToast />

      <div
        style={{
          display: "flex", alignItems: "center", gap: 20, padding: "0 18px", height: 52,
          borderBottom: `1px solid ${HUD.lineDim}`, position: "sticky", top: 0, zIndex: 60, background: HUD.bg,
        }}
      >
        <div style={{ fontFamily: HUD.fontDisplay, fontWeight: 700, fontSize: 16, letterSpacing: "0.1em", color: HUD.cyan, textShadow: "0 0 10px rgba(95,224,255,0.6)" }}>
          AEROLEADAI<span style={{ color: HUD.muted, fontWeight: 500, marginLeft: 6, fontSize: 11 }}>PROPERTY INTELLIGENCE GRID</span>
        </div>
        <div style={{ flex: 1, fontSize: 11, color: HUD.muted, letterSpacing: "0.03em" }}>
          {pathname === "/" ? "CONSOLE" : pathname?.replace("/", "").toUpperCase() || "CONSOLE"}
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: HUD.muted, padding: "4px 10px", border: `1px solid ${HUD.lineDim}`, borderRadius: 3 }}>
            <span
              style={{
                width: 6, height: 6, borderRadius: "50%",
                background: totalCount && okCount === totalCount ? HUD.green : totalCount ? HUD.amber : HUD.muted,
                boxShadow: totalCount ? `0 0 8px ${okCount === totalCount ? HUD.green : HUD.amber}` : "none",
              }}
            />
            {totalCount ? `SYSTEMS ${okCount}/${totalCount}` : "SYSTEMS —"}
          </div>
        </div>
      </div>

      <div style={{ display: "flex", minHeight: "calc(100vh - 52px)" }}>
        <div style={{ width: 200, flexShrink: 0, borderRight: `1px solid ${HUD.lineDim}`, padding: "16px 0" }}>
          <div style={{ fontSize: 10, color: HUD.muted, letterSpacing: "0.12em", padding: "4px 16px 8px", textTransform: "uppercase" }}>Modules</div>
          {MODULES.map((m) => {
            const active = pathname === m.href;
            return (
              <Link
                key={m.href}
                href={m.href}
                style={{
                  display: "block", padding: "9px 16px", fontSize: 12, textDecoration: "none",
                  color: active ? HUD.cyan : HUD.muted,
                  borderLeft: `2px solid ${active ? HUD.cyan : "transparent"}`,
                  background: active ? "rgba(95,224,255,0.06)" : "transparent",
                }}
              >
                {m.label}
              </Link>
            );
          })}
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
      </div>
    </div>
  );
}
