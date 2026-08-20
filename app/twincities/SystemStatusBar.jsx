"use client";

import { useEffect, useState } from "react";

const tones = {
  LIVE: "#4dffb3",
  OPERATIONAL_READ_PATH: "#4dffb3",
  READ_PATH_OK_WORKER_DEGRADED: "#ffb14a",
  DEGRADED_WRITE_QUEUE: "#ffb14a",
  CACHED_READ: "#ffb14a",
  DEGRADED: "#ff765f",
  OFFLINE: "#ff765f",
};

export default function SystemStatusBar() {
  const [mode, setMode] = useState("CHECKING");
  const [pending, setPending] = useState(0);
  const [note, setNote] = useState("Checking live data paths…");

  useEffect(() => {
    let cancelled = false;
    const onSystem = e => {
      const d = e.detail || {};
      if (d.count != null) setPending(Number(d.count || 0));
      if (d.mode) setMode(d.mode);
      if (d.type === "cache-read") setNote("Showing previously retrieved real data while live read is unavailable.");
      else if (d.type === "write-queued") setNote("Server write is constrained. Action is pending, not completed.");
      else if (d.type === "queue-drained") setNote("Pending actions successfully persisted.");
      else if (d.type === "browser-offline") setNote("Browser is offline. Live provider work is paused.");
      else if (d.type === "live-read") setNote("Live server data path responding.");
    };
    const onQueue = e => setPending(Number(e.detail?.count || 0));
    window.addEventListener("aerolead:system", onSystem);
    window.addEventListener("aerolead:queue", onQueue);

    const check = async () => {
      try {
        const r = await fetch(`/api/system-health?_=${Date.now()}`, { cache: "no-store" });
        const d = await r.json();
        if (cancelled) return;
        setMode(d.mode || (d.healthy ? "LIVE" : "DEGRADED"));
        setNote(d.healthy ? "Live property, contractor and worker read paths verified." : "Some live paths are degraded. No synthetic data is being substituted.");
      } catch {
        if (!cancelled) { setMode("OFFLINE"); setNote("Health check unavailable. Existing real data may remain visible."); }
      }
    };
    check();
    const timer = setInterval(check, 90_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
      window.removeEventListener("aerolead:system", onSystem);
      window.removeEventListener("aerolead:queue", onQueue);
    };
  }, []);

  const color = tones[mode] || "#35eee8";
  const label = mode === "OPERATIONAL_READ_PATH" ? "LIVE READ" : mode.replaceAll("_", " ");
  return <div style={{position:"sticky",top:0,zIndex:9999,background:"rgba(2,7,10,.96)",borderBottom:`1px solid ${color}`,color:"#ecfbff",font:"10px ui-monospace,monospace",padding:"7px 12px",display:"flex",gap:12,alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",backdropFilter:"blur(10px)"}}>
    <div style={{display:"flex",gap:9,alignItems:"center",flexWrap:"wrap"}}><b style={{color}}>● {label}</b><span style={{color:"#78949d"}}>{note}</span></div>
    <div style={{color:pending?"#ffb14a":"#78949d"}}>{pending ? `${pending} PENDING SERVER ACTION${pending===1?"":"S"}` : "NO PENDING ACTIONS"}</div>
  </div>;
}
