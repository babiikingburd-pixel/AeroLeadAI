"use client";
import { useEffect, useState } from "react";

export default function ApexRoofingCommand() {
  const [state,setState]=useState({loading:true,opportunities:[],error:null,contractor_priority:null});
  useEffect(()=>{ fetch("/api/opportunities/top10").then(r=>r.json()).then(x=>setState({...x,loading:false})).catch(e=>setState({loading:false,error:e.message,opportunities:[]})); },[]);
  return <main style={{padding:24,fontFamily:"system-ui"}}>
    <h1>Apex Roofing — Priority Command</h1>
    <p><b>Contractor priority #1.</b> Property rankings remain evidence-based.</p>
    {state.loading && <p>Loading Top 10…</p>}
    {state.error && <p>Unable to load: {state.error}</p>}
    <ol>{state.opportunities.map(o=><li key={o.id} style={{margin:"14px 0"}}>
      <b>{o.address}</b> — {o.city}, {o.county} — opportunity {o.opportunity_score}/100
      <div>Evidence {o.evidence_score} · Priority {o.existing_priority_score} · Confidence {o.confidence_score}%</div>
      <small>Routed to: Apex Roofing · property rank #{o.property_rank}</small>
    </li>)}</ol>
  </main>;
}
