const bool = v => v===true || v===1 || String(v).toLowerCase()==="true";
export function calibrateOutcomes(records=[]) {
  const rows = records.filter(Boolean);
  if(!rows.length) return {sampleSize:0, precision:null, soldRate:null, note:"No labeled outcomes yet."};
  let predicted=0, confirmed=0, sold=0, disagreements=0;
  for(const r of rows){
    const hot=Number(r.predicted_score ?? r.score ?? 0)>=70;
    const good=bool(r.confirmed) || ["confirmed","sold","quoted","inspected"].includes(String(r.outcome||r.status||"").toLowerCase());
    if(hot){predicted++; if(good) confirmed++;}
    if(String(r.outcome||r.status||"").toLowerCase()==="sold") sold++;
    if(r.human_agreed===false) disagreements++;
  }
  return {
    sampleSize: rows.length,
    precision: predicted ? Number((confirmed/predicted*100).toFixed(1)) : null,
    soldRate: Number((sold/rows.length*100).toFixed(1)),
    humanDisagreementRate: Number((disagreements/rows.length*100).toFixed(1)),
    note: rows.length < 30 ? "Directional only — collect at least 30 labeled outcomes before treating this as calibrated." : "Calibration sample is large enough for operational monitoring."
  };
}
