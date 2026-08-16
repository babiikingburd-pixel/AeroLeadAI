const rad = d => d * Math.PI / 180;
const dist = (a,b) => {
  const R=3958.8, dLat=rad(b.lat-a.lat), dLon=rad(b.lon-a.lon);
  const x=Math.sin(dLat/2)**2+Math.cos(rad(a.lat))*Math.cos(rad(b.lat))*Math.sin(dLon/2)**2;
  return 2*R*Math.asin(Math.sqrt(x));
};
const score = p => Number(p.opportunity_score ?? p.score ?? p.priority_score ?? 0);

export function buildOpportunityCluster(anchor={}, candidates=[], radiusMiles=1.5) {
  if(!Number.isFinite(Number(anchor.lat)) || !Number.isFinite(Number(anchor.lon)))
    return {ok:false, reason:"Anchor coordinates required.", members:[]};
  const origin={lat:Number(anchor.lat),lon:Number(anchor.lon)};
  const members=candidates.filter(p=>p && Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lon)))
    .map(p=>({...p,distanceMiles:Number(dist(origin,{lat:Number(p.lat),lon:Number(p.lon)}).toFixed(2))}))
    .filter(p=>p.distanceMiles<=radiusMiles)
    .sort((a,b)=>score(b)-score(a));
  const avg=members.length?Math.round(members.reduce((a,p)=>a+score(p),0)/members.length):0;
  return {
    ok:true, radiusMiles, count:members.length, averageOpportunity:avg,
    hotCount:members.filter(p=>score(p)>=80).length,
    clusterScore:Math.min(100, Math.round(avg*.72 + Math.min(28,members.length*3))),
    members
  };
}
