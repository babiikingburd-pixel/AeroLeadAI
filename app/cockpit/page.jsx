"use client";
import dynamic from "next/dynamic";
import CockpitOverlay from "../../components/cockpit/CockpitOverlay";

const LeadMap = dynamic(() => import("../../components/LeadMap"), { ssr:false, loading:() => <div className="cockpit-map-loading">INITIALIZING CARTOGRAPHIC ENGINE…</div> });

export default function CockpitPage() {
  return <main className="cockpit-stage"><div className="cockpit-map"><LeadMap /></div><CockpitOverlay /></main>;
}
