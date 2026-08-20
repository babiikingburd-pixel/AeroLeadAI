"use client";

import { useEffect, useRef } from "react";

const INTERVAL_MS = 180_000;

export default function SwarmHeartbeat() {
  const running = useRef(false);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      if (cancelled || running.current || document.hidden || !navigator.onLine) return;
      running.current = true;
      try {
        const rawFetch = window.__AEROLEAD_NATIVE_FETCH__ || window.fetch.bind(window);
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15_000);
        await Promise.allSettled([
          rawFetch("/api/twincities/evidence-cycle", {
            method: "POST",
            headers: { "content-type": "application/json", "x-aerolead-background": "1" },
            body: JSON.stringify({ limit: 3, source: "twincities-heartbeat" }),
            cache: "no-store",
            signal: controller.signal,
          }),
          rawFetch("/api/twincities/autonomous-cycle", {
            method: "POST",
            headers: { "content-type": "application/json", "x-aerolead-background": "1" },
            body: JSON.stringify({ source: "twincities-heartbeat", lightweight: true }),
            cache: "no-store",
            signal: controller.signal,
          }),
        ]);
        clearTimeout(timeout);
      } catch {
        // Background maintenance can fail silently at the transport layer because it is not a user action.
        // Health/status UI reports the degraded server state; no fake completion and no client action is queued.
      } finally {
        running.current = false;
      }
    };

    const first = setTimeout(run, 10_000);
    const timer = setInterval(run, INTERVAL_MS);
    const onVisibility = () => { if (!document.hidden) setTimeout(run, 1500); };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      clearTimeout(first);
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return null;
}
