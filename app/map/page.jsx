"use client";
// Performance: the map (Mapbox GL is heavy) is now lazy-loaded client-side
// only, so it never blocks the initial bundle or other tabs.
import dynamic from "next/dynamic";

const LeadMap = dynamic(() => import("../../components/LeadMap"), {
  ssr: false,
  loading: () => <div style={{ padding: 40, color: "#6b7c93", fontFamily: "monospace" }}>Loading map…</div>,
});

export default function MapPage() { return <LeadMap />; }
