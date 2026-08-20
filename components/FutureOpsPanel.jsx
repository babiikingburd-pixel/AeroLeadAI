"use client";
const C={panel:"#07131a",line:"#1d4651",cyan:"#2cecea",text:"#ecfbff",mute:"#79959e",green:"#4dffaf",amber:"#ffd166",red:"#ff6f84"};

export default function FutureOpsPanel({futureOps}){
  if(!futureOps) return <div style={box}>Future Ops becomes available after Commander evaluates the property.</div>;
  const d=futureOps.leadDecay||{}, w=futureOps.opportunityWindow||{}, e=futureOps.economics||{};
  return <section style={box}>
    <div style={{fontFamily:"monospace",color:C.cyan,letterSpacing:2,fontSize:11}}>AEROLEADAI 9.2 / FUTURE OPS</div>
    <h2 style={{margin:"6px 0 14px"}}>{futureOps.actionClass} · {w.window}</h2>
    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))",gap:9}}>
      <Metric label="ADJUSTED LEAD" value={d.adjustedScore}/>
      <Metric label="FRESHNESS" value={`${d.freshness ?? 0}%`}/>
      <Metric label="DECAY PENALTY" value={`-${d.decayPenalty ?? 0}`}/>
      <Metric label="EXPECTED VALUE" value={`$${Number(e.expectedValue||0).toLocaleString()}`}/>
      <Metric label="RESEARCH COST" value={`$${e.estimatedResearchCost ?? 0}`}/>
      <Metric label="VALUE / RESEARCH" value={`${e.valueToResearchRatio ?? 0}×`}/>
    </div>
    <div style={{marginTop:12,border:`1px solid ${C.line}`,padding:11}}>
      <b style={{color:C.green}}>WHY NOW</b>
      <div style={{marginTop:4}}>{futureOps.explanation}</div>
      <small style={{display:"block",color:C.mute,marginTop:5}}>{w.rationale}</small>
    </div>
    {!!futureOps.unknowns?.length && <div style={{marginTop:12}}>
      <b style={{color:C.amber}}>UNKNOWN / MISSING</b>
      {futureOps.unknowns.map(x=><div key={x} style={{padding:"5px 0",borderBottom:`1px solid ${C.line}`}}>• {x}</div>)}
    </div>}
    {!!futureOps.contradictions?.length && <div style={{marginTop:12}}>
      <b style={{color:C.red}}>CONTRADICTIONS</b>
      {futureOps.contradictions.map(x=><div key={x}>• {x}</div>)}
    </div>}
    <small style={{display:"block",color:C.mute,marginTop:12}}>Research-spend decision: {e.recommendation}. Scores decay when evidence ages instead of staying permanently “hot.”</small>
  </section>;
}
function Metric({label,value}){return <div style={{border:`1px solid ${C.line}`,padding:11,background:"#050b0f"}}><small style={{color:C.mute}}>{label}</small><b style={{display:"block",fontSize:22,color:C.cyan}}>{value}</b></div>}
const box={background:C.panel,border:`1px solid ${C.line}`,padding:14,color:C.text};
