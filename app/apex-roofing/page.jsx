"use client";
import { useEffect, useState } from "react";

function ProspectCard({ o }) {
  const [ev,setEv]=useState({loading:true,images:[],error:null});
  useEffect(()=>{
    let live=true;
    const address=[o.address,o.city,o.state||"MN",o.zip].filter(Boolean).join(", ");
    fetch("/api/eagleview",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({address,lat:o.lat,lon:o.lon,wait:true,maxWaitMs:18000})})
      .then(r=>r.json()).then(x=>{if(live)setEv({loading:false,images:x.images||[],error:x.ok?null:x.error||"Imagery unavailable"})})
      .catch(e=>{if(live)setEv({loading:false,images:[],error:e.message})});
    return()=>{live=false};
  },[o.id,o.address,o.lat,o.lon]);
  const hero=ev.images?.[0]?.proxyUrl;
  return <article style={{background:"#071015",border:"1px solid #1b4650",borderRadius:12,overflow:"hidden",boxShadow:"0 12px 35px #0008"}}>
    <div style={{height:230,background:"#020608",position:"relative",overflow:"hidden"}}>
      {hero?<img src={hero} alt={o.address} style={{width:"100%",height:"100%",objectFit:"cover",transform:"scale(1.03)"}}/>:<div style={{height:"100%",display:"grid",placeItems:"center",color:"#79a0aa",fontFamily:"monospace"}}>{ev.loading?"EAGLEVIEW · ACQUIRING + ANALYZING…":ev.error||"IMAGE PENDING"}</div>}
      <div style={{position:"absolute",top:10,right:10,background:"#001015e8",border:"1px solid #31f0e9",padding:"8px 10px",color:"#31f0e9",fontWeight:800}}>OPP {o.opportunity_score}</div>
      <div style={{position:"absolute",left:10,bottom:10,background:"#001015e8",padding:"6px 9px",fontSize:11,color:"#dff"}}>EVIDENCE {o.evidence_score} · CONF {o.confidence_score}%</div>
    </div>
    {ev.images.length>1&&<div style={{display:"flex",gap:5,padding:6,overflowX:"auto",background:"#04090c"}}>{ev.images.slice(1,5).map((im,i)=><img key={im.token||i} src={im.proxyUrl} alt="" style={{width:76,height:52,objectFit:"cover",border:"1px solid #1d4b55"}}/>)}</div>}
    <div style={{padding:15}}>
      <div style={{color:"#35eee8",fontFamily:"monospace",fontSize:11}}>APEX RANK #{o.property_rank} · LIVE PROPERTY INTELLIGENCE</div>
      <h2 style={{fontSize:18,margin:"6px 0"}}>{o.address}</h2><div style={{color:"#91aab1"}}>{o.city}, {o.county}</div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:7,marginTop:12}}><Metric l="ROOF" v={o.roof_visual_score}/><Metric l="PRIORITY" v={o.existing_priority_score}/><Metric l="VALIDATION" v={o.validation_score}/></div>
      <a href={`/property-intelligence/${o.id}`} style={{display:"block",marginTop:13,padding:10,border:"1px solid #2adbd6",color:"#2ef0ea",textDecoration:"none",textAlign:"center",fontWeight:700}}>OPEN PROPERTY TWIN →</a>
    </div>
  </article>;
}
function Metric({l,v}){return <div style={{border:"1px solid #173941",padding:8}}><small style={{color:"#728d94"}}>{l}</small><b style={{display:"block",fontSize:18}}>{v||0}</b></div>}
export default function ApexRoofingCommand(){const[state,setState]=useState({loading:true,opportunities:[],error:null});useEffect(()=>{fetch("/api/opportunities/top10").then(r=>r.json()).then(x=>setState({...x,loading:false})).catch(e=>setState({loading:false,error:e.message,opportunities:[]}));},[]);return <main style={{minHeight:"100vh",padding:24,fontFamily:"system-ui",background:"radial-gradient(circle at top right,#0b3039,#04080b 45%)",color:"#edfaff"}}><div style={{maxWidth:1450,margin:"auto"}}><div style={{color:"#31e8e2",fontFamily:"monospace",letterSpacing:2}}>AEROLEADAI / APEX ROOFING</div><h1 style={{fontSize:34,margin:"5px 0"}}>Visual Priority Command</h1><p style={{color:"#8ba4ab"}}>Every prospect acquires professional imagery immediately. Images are cropped into visual cards and paired with the existing evidence, roof, validation and opportunity analysis.</p>{state.loading&&<p>Ranking properties and starting imagery acquisition…</p>}{state.error&&<p>{state.error}</p>}<section style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(310px,1fr))",gap:16,marginTop:22}}>{state.opportunities.map(o=><ProspectCard key={o.id} o={o}/>)}</section></div></main>}
