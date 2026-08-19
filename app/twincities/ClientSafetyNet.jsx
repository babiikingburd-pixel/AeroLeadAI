"use client";

import { useEffect } from "react";

const CACHE_PREFIX = "aerolead:api-cache:";
const QUEUE_KEY = "aerolead:pending-actions";
const MAX_CACHE_AGE = 24 * 60 * 60 * 1000;
const RETRY_INTERVAL = 45_000;

function isJsonResponse(res) {
  return String(res?.headers?.get?.("content-type") || "").includes("application/json");
}

function cacheKey(input, init = {}) {
  const url = typeof input === "string" ? input : input?.url || "";
  const method = String(init?.method || (typeof input !== "string" ? input?.method : "GET") || "GET").toUpperCase();
  return `${CACHE_PREFIX}${method}:${url.replace(/([?&])_=[^&]*/g, "$1").replace(/[?&]$/, "")}`;
}

function readQueue() {
  try { return JSON.parse(localStorage.getItem(QUEUE_KEY) || "[]"); }
  catch { return []; }
}

function writeQueue(items) {
  try { localStorage.setItem(QUEUE_KEY, JSON.stringify(items.slice(-250))); } catch {}
  window.dispatchEvent(new CustomEvent("aerolead:queue", { detail: { count: items.length } }));
}

function enqueue(url, init = {}, reason = "backend unavailable") {
  const items = readQueue();
  const body = typeof init.body === "string" ? init.body : null;
  const fingerprint = `${String(init.method || "POST").toUpperCase()}:${url}:${body || ""}`;
  if (!items.some(x => x.fingerprint === fingerprint && x.status === "pending")) {
    items.push({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      fingerprint,
      url,
      method: String(init.method || "POST").toUpperCase(),
      headers: { "content-type": "application/json" },
      body,
      queuedAt: new Date().toISOString(),
      attempts: 0,
      status: "pending",
      reason,
    });
    writeQueue(items);
  }
  return items.length;
}

function syntheticQueuedResponse(url, count, reason) {
  let payload = { ok: true, queuedOffline: true, pendingActions: count, message: "Action accepted on this device and queued until the server can write again." };
  if (url.includes("/evidence-cycle")) payload = { ...payload, processed: 0, persisted: 0, queued: count };
  if (url.includes("/supercharge")) payload = { ...payload, queued: 0, alreadyActive: 0, matched: 0, mode: "CLIENT_QUEUE" };
  if (url.includes("/lead-review")) payload = { ...payload, savedLocally: true };
  return new Response(JSON.stringify(payload), {
    status: 202,
    headers: { "content-type": "application/json", "x-aerolead-fallback": reason || "queued" },
  });
}

export default function ClientSafetyNet() {
  useEffect(() => {
    if (window.__AEROLEAD_FETCH_GUARD__) return;
    window.__AEROLEAD_FETCH_GUARD__ = true;

    const nativeFetch = window.fetch.bind(window);
    window.__AEROLEAD_NATIVE_FETCH__ = nativeFetch;

    window.fetch = async (input, init = {}) => {
      const url = typeof input === "string" ? input : input?.url || "";
      const method = String(init?.method || (typeof input !== "string" ? input?.method : "GET") || "GET").toUpperCase();
      const isLocalApi = url.startsWith("/api/") || url.includes("/api/");
      if (!isLocalApi) return nativeFetch(input, init);

      const key = cacheKey(input, init);
      try {
        const res = await nativeFetch(input, init);
        if (method === "GET" && res.ok && isJsonResponse(res)) {
          try {
            const clone = res.clone();
            const json = await clone.json();
            localStorage.setItem(key, JSON.stringify({ at: Date.now(), json }));
          } catch {}
        }

        if (method !== "GET" && (res.status === 507 || res.status === 503 || res.status === 500 || res.status === 504 || res.status === 429)) {
          const text = await res.clone().text().catch(() => "");
          const readOnly = /read[- ]only|cannot execute (insert|update|delete)|quota|disk|limit|timeout/i.test(text);
          if (readOnly || res.status === 504 || res.status === 507) {
            const count = enqueue(url, init, text.slice(0, 180) || `HTTP ${res.status}`);
            return syntheticQueuedResponse(url, count, `HTTP ${res.status}`);
          }
        }
        return res;
      } catch (error) {
        if (method === "GET") {
          try {
            const cached = JSON.parse(localStorage.getItem(key) || "null");
            if (cached?.json && Date.now() - Number(cached.at || 0) < MAX_CACHE_AGE) {
              return new Response(JSON.stringify({ ...cached.json, clientCached: true }), {
                status: 200,
                headers: { "content-type": "application/json", "x-aerolead-fallback": "cache" },
              });
            }
          } catch {}
          throw error;
        }
        const count = enqueue(url, init, error?.message || "network error");
        return syntheticQueuedResponse(url, count, error?.message || "network error");
      }
    };

    const retry = async () => {
      if (!navigator.onLine || document.hidden) return;
      const queue = readQueue();
      if (!queue.length) return;
      const next = [];
      for (const item of queue.slice(0, 8)) {
        try {
          const res = await nativeFetch(item.url, { method: item.method, headers: item.headers, body: item.body, cache: "no-store" });
          if (!res.ok) {
            next.push({ ...item, attempts: (item.attempts || 0) + 1, lastAttemptAt: new Date().toISOString() });
          }
        } catch {
          next.push({ ...item, attempts: (item.attempts || 0) + 1, lastAttemptAt: new Date().toISOString() });
        }
      }
      next.push(...queue.slice(8));
      writeQueue(next);
    };

    const timer = setInterval(retry, RETRY_INTERVAL);
    window.addEventListener("online", retry);
    retry();

    return () => {
      clearInterval(timer);
      window.removeEventListener("online", retry);
    };
  }, []);

  return null;
}
