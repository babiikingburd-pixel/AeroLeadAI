"use client";

import { useEffect, useRef } from "react";

const INTERVAL_MS = 60_000;

export default function SwarmHeartbeat() {
  const running = useRef(false);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      if (cancelled || running.current || document.hidden) return;
      running.current = true;
      try {
        await Promise.allSettled([
          fetch("/api/twincities/evidence-cycle", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ limit: 12, source: "twincities-heartbeat" }),
            cache: "no-store",
          }),
          fetch("/api/twincities/autonomous-cycle", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ source: "twincities-heartbeat" }),
            cache: "no-store",
          }),
        ]);
      } finally {
        running.current = false;
      }
    };

    const first = setTimeout(run, 2500);
    const timer = setInterval(run, INTERVAL_MS);
    const onVisibility = () => { if (!document.hidden) run(); };
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
