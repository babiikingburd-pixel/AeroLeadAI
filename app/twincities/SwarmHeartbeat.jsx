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
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15_000);
        await Promise.allSettled([
          fetch("/api/twincities/evidence-cycle", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ limit: 3, source: "twincities-heartbeat" }),
            cache: "no-store",
            signal: controller.signal,
          }),
          fetch("/api/twincities/autonomous-cycle", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ source: "twincities-heartbeat", lightweight: true }),
            cache: "no-store",
            signal: controller.signal,
          }),
        ]);
        clearTimeout(timeout);
      } catch {
        // ClientSafetyNet queues constrained writes. The UI must never stall on heartbeat work.
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
