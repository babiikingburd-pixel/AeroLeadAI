"use client";
import { useEffect, useState } from 'react';
import { APEX_RELEASES, APEX_VERSION, scoreOpportunity, evidenceConfidence } from '../../lib/apex/releaseTrain';

const card = { border:'1px solid #1c3540', background:'#071018', borderRadius:8, padding:16 };
export default function ApexPage() {
  const [health,setHealth]=useState(null);
  useEffect(()=>{fetch('/api/apex-status').then(r=>r.json()).then(setHealth).catch(()=>{});},[]);
  const score = scoreOpportunity({damageProbability:88,propertyValue:82,serviceFit:90,contactability:75,conversionProbability:68,confidence:91,freshness:94});
  const conf = evidenceConfidence({sourceQuality:92,freshness:94,completeness:84,agreement:90});
  return <main style={{padding:24,color:'#d8f6ff',fontFamily:'JetBrains Mono, monospace',maxWidth:1200,margin:'0 auto'}}>
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'end',marginBottom:22}}>
      <div><div style={{fontSize:11,color:'#62d9ff',letterSpacing:3}}>AEROLEADAI / RELEASE TRAIN</div><h1 style={{margin:'8px 0',fontSize:30}}>APEX {APEX_VERSION}</h1><div style={{color:'#7e9aa5'}}>Readable, buildable, installable progression from 9.0 → {APEX_VERSION}.</div></div>
      <div style={{...card,minWidth:190}}><div style={{fontSize:10,color:'#7e9aa5'}}>LIVE RELEASE</div><strong style={{fontSize:24}}>{APEX_VERSION}</strong><div style={{color:'#6dffb0'}}>READY TO PACKAGE</div></div>
    </div>
    <section style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(250px,1fr))',gap:12,marginBottom:20}}>
      {APEX_RELEASES.map(r=><div key={r.version} style={{...card,borderColor:r.version===APEX_VERSION?'#62d9ff':'#1c3540'}}><div style={{display:'flex',justifyContent:'space-between'}}><strong>APEX {r.version}</strong><span style={{fontSize:10,color:r.version===APEX_VERSION?'#6dffb0':'#62d9ff'}}>{r.status.toUpperCase()}</span></div><h3 style={{margin:'10px 0 6px'}}>{r.name}</h3><ul style={{paddingLeft:18,margin:0,lineHeight:1.7,fontSize:12}}>{r.capabilities.map(x=><li key={x}>{x}</li>)}</ul></div>)}
    </section>
    <section style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(260px,1fr))',gap:12}}>
      <div style={card}><div style={{fontSize:10,color:'#7e9aa5'}}>EXAMPLE OPPORTUNITY SCORE</div><div style={{fontSize:44,margin:'8px 0'}}>{score}</div><div style={{color:'#7e9aa5',fontSize:12}}>Damage × value × fit × contactability × conversion × confidence × freshness.</div></div>
      <div style={card}><div style={{fontSize:10,color:'#7e9aa5'}}>EXAMPLE EVIDENCE CONFIDENCE</div><div style={{fontSize:44,margin:'8px 0'}}>{conf}%</div><div style={{color:'#7e9aa5',fontSize:12}}>Source quality + freshness + completeness + source agreement.</div></div>
      <div style={card}><div style={{fontSize:10,color:'#7e9aa5'}}>BUILD / INSTALL HEALTH</div>{health?.checks?.map(c=><div key={c.name} style={{display:'flex',justifyContent:'space-between',fontSize:11,padding:'6px 0',borderBottom:'1px solid #10232c'}}><span>{c.name}</span><span style={{color:c.ok?'#6dffb0':'#ff8d8d'}}>{c.ok?'PASS':'FAIL'}</span></div>) || <div>Checking…</div>}</div>
    </section>
  </main>;
}
