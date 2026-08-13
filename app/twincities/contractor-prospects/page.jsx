"use client";
import { useEffect, useState } from "react";
import { HUD } from "../../../lib/hudTheme";

export default function ContractorProspectsPage() {
  const [prospects,setProspects]=useState([]); const [selected,setSelected]=useState(null); const [leads,setLeads]=useState([]); const [loading,setLoading]=useState(true);
  async function load(name){ setLoading(true); const r=await fetch(`/api/contractor-prospects${name?`?name=${encodeURIComponent(name)}`:""}`); const d=await r.json(); if(d.ok){setProspects(d.prospects||[]); if(name){setSelected(d.contractor);setLeads(d.leads||[]);} } setLoading(false); }
  useEffect(()=>{load()},[]);
  const pitch = selected ? `Hi, I’m local and I built a Twin Cities property/storm intelligence system for roofing companies. I’m testing it with a small group of local contractors and built a territory-specific report for ${selected.business_name}. It identifies properties that are worth an inspection based on documented storm/property signals — not claims of confirmed damage. I’d like to show you 10 opportunities in your service area and let you judge whether they’re useful. If they produce real inspections, we can discuss a small paid pilot and territory exclusivity.` : "";
  return <div style={{minHeight:"100vh",background:HUD.bg,color:HUD.ice,fontFamily:HUD.fontMono,padding:24}}>
    <a href="/twincities" style={{color:HUD.cyan}}>← Twin Cities Engine</a>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-end",flexWrap:"wrap",gap:12}}>
      <h1 style={{color:HUD.cyan,fontFamily:HUD.fontDisplay}}>CONTRACTOR PROSPECT BENCH</h1>
      <a href="/twincities/contractor-prospects/add" style={{padding:"9px 16px",border:`1px solid ${HUD.amber}`,color:HUD.amber,borderRadius:4,textDecoration:"none",fontSize:12,fontWeight:700}}>+ Add Contractor (Deep Search) →</a>
    </div>
    <p style={{color:HUD.muted,fontSize:12}}>Prospects are outreach targets only. They are not onboarded or verified contractors.</p>
    {loading && <div>Loading…</div>}
    {!selected && <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(280px,1fr))",gap:12}}>{prospects.map((p,i)=><div key={p.business_name} style={{border:`1px solid ${HUD.lineDim}`,padding:14,borderRadius:6}}><div style={{fontWeight:800,color:HUD.ice}}>{i+1}. {p.business_name}</div><div style={{color:HUD.green,margin:"8px 0"}}>Pitch fit: {p.prospect_score}/100</div><div style={{color:HUD.muted,fontSize:11}}>Target cities: {(p.service_area_cities||[]).join(", ")}</div><button onClick={()=>load(p.business_name)} style={{marginTop:12,padding:"8px 12px",background:"transparent",border:`1px solid ${HUD.amber}`,color:HUD.amber,borderRadius:4,cursor:"pointer"}}>Generate Pitch + 10 →</button></div>)}</div>}
    {selected && <div><button onClick={()=>{setSelected(null);setLeads([])}} style={{padding:"7px 12px",background:"transparent",border:`1px solid ${HUD.lineDim}`,color:HUD.muted}}>← All prospects</button><h2 style={{color:HUD.amber}}>{selected.business_name} — SALES PITCH</h2><div style={{border:`1px solid ${HUD.lineDim}`,padding:16,borderRadius:6,whiteSpace:"pre-wrap",lineHeight:1.6}}>{pitch}</div><h3 style={{color:HUD.cyan}}>Top 10 territory opportunities</h3>{leads.length===0?<div style={{color:HUD.muted}}>No qualifying leads were returned for this prospect's configured service area yet. Generate/prime leads first; the system will not invent addresses.</div>:<ol>{leads.map(l=><li key={l.id} style={{marginBottom:10}}><strong>{l.address||l.property_address||"Address unavailable"}</strong> — score {Math.round(l._score)} {l.city?`· ${l.city}`:""}</li>)}</ol>}<button onClick={()=>navigator.clipboard?.writeText(pitch)} style={{padding:"9px 14px",background:"transparent",border:`1px solid ${HUD.green}`,color:HUD.green,borderRadius:4}}>Copy Pitch</button></div>}
  </div>
}
