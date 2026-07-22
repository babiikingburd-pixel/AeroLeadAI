"use client";
import { useState } from "react";

// One-tap autonomous address detection: browser geolocation (permission
// prompt) -> server reverse-geocode -> auto-populate the search box. Falls
// back to ZIP if GPS is denied/unavailable.
export default function AutoLocate({ onResolved, style = {} }) {
  const [state, setState] = useState("idle"); // idle | locating | done | error
  const [msg, setMsg] = useState("");

  function locate() {
    if (!navigator.geolocation) {
      setState("error"); setMsg("No GPS on this device — type a ZIP instead.");
      return;
    }
    setState("locating"); setMsg("");
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude: lat, longitude: lon } = pos.coords;
        try {
          const res = await fetch("/api/reverse-geocode", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ lat, lon }),
          });
          const d = await res.json();
          if (d.ok && (d.address || d.zip)) {
            setState("done");
            setMsg(d.address ? "Located" : `ZIP ${d.zip} (street unavailable)`);
            onResolved({ address: d.address || d.zip, zip: d.zip, lat: String(lat), lon: String(lon) });
          } else {
            setState("error"); setMsg(d.error || "Could not resolve address — enter a ZIP.");
          }
        } catch (e) {
          setState("error"); setMsg("Lookup failed — enter a ZIP instead.");
        }
      },
      () => { setState("error"); setMsg("Location permission denied — enter a ZIP instead."); },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8, ...style }}>
      <button onClick={locate} disabled={state === "locating"}
        style={{ padding: "6px 12px", background: "transparent", border: "1px solid #2e7dd1", borderRadius: 6, color: state === "locating" ? "#6b7c93" : "#2e7dd1", fontSize: 12, cursor: "pointer" }}>
        {state === "locating" ? "Locating…" : "📍 Use my location"}
      </button>
      {msg && <span style={{ fontSize: 11, color: state === "error" ? "#e5534b" : "#4caf7d" }}>{msg}</span>}
    </span>
  );
}
