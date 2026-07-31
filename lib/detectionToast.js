// Lightweight pub/sub so any page can trigger the tactical-HUD "high-value
// target acquired" toast without a global store — just a window CustomEvent.
// Callers dispatch real detections (e.g. a realtime INSERT with high
// urgency); nothing here invents an event on its own.
const EVENT_NAME = "aerolead:detection";

export function fireDetectionToast({ title, subtitle }) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: { title, subtitle } }));
}

export function onDetectionToast(handler) {
  if (typeof window === "undefined") return () => {};
  const listener = (e) => handler(e.detail);
  window.addEventListener(EVENT_NAME, listener);
  return () => window.removeEventListener(EVENT_NAME, listener);
}
