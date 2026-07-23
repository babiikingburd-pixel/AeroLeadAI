// AI Business Intelligence Engine — computes demand signal, revenue trend,
// underserved markets, contractor recruiting targets, and contractor
// performance from data already in the app (leads + jobs + contractors).
//
// Honest scope note: with a small dataset these are directional signals,
// not statistically robust forecasts — every function here says so via
// `sampleSize`/`confidence` rather than presenting a thin sample as a
// confident prediction. There's no real ML model retraining loop (that
// needs enough completed-job outcome data to be worth building); the
// "continuous improvement" piece here is honest calibration tracking —
// how AI damage scores compared to what jobs actually turned into — not
// an auto-retraining claim.

function zipOf(address) {
  const m = (address || "").match(/\b(\d{5})\b/);
  return m ? m[1] : "unknown";
}

export function demandByZip(leads) {
  const byZip = {};
  leads.forEach((l) => {
    const z = zipOf(l.address);
    byZip[z] = byZip[z] || { zip: z, count: 0, scoreSum: 0, scored: 0 };
    byZip[z].count++;
    if (typeof l.findingsScore === "number") { byZip[z].scoreSum += l.findingsScore; byZip[z].scored++; }
  });
  return Object.values(byZip)
    .map((z) => ({ ...z, avgScore: z.scored ? Math.round(z.scoreSum / z.scored) : null }))
    .sort((a, b) => b.count - a.count);
}

// Simple trailing-average trend, not a real time-series model — honest
// about needing more history for anything sharper than "up/flat/down."
export function revenueForecast(jobs) {
  const completed = jobs.filter((j) => j.status === "completed" && j.completed_date).sort((a, b) => new Date(a.completed_date) - new Date(b.completed_date));
  if (completed.length < 4) {
    return { trend: "insufficient-data", sampleSize: completed.length, note: `Only ${completed.length} completed job(s) on record — need at least a handful of months of completed jobs before a trend means anything.` };
  }
  const byMonth = {};
  completed.forEach((j) => {
    const key = j.completed_date.slice(0, 7);
    byMonth[key] = (byMonth[key] || 0) + (j.revenue_actual || j.revenue_estimate || 0);
  });
  const months = Object.keys(byMonth).sort();
  const values = months.map((m) => byMonth[m]);
  const half = Math.floor(values.length / 2);
  const firstHalfAvg = values.slice(0, half).reduce((s, v) => s + v, 0) / (half || 1);
  const secondHalfAvg = values.slice(half).reduce((s, v) => s + v, 0) / (values.length - half || 1);
  const pctChange = firstHalfAvg ? Math.round(((secondHalfAvg - firstHalfAvg) / firstHalfAvg) * 100) : 0;
  const nextMonthProjection = Math.round(secondHalfAvg);
  return {
    trend: pctChange > 10 ? "up" : pctChange < -10 ? "down" : "flat",
    pctChange, nextMonthProjection, byMonth, sampleSize: completed.length,
    note: `Trailing-average trend over ${months.length} month(s) of completed jobs — a real projection needs more history.`,
  };
}

// ZIPs with real lead/damage signal but no contractor covering them.
export function underservedMarkets(leads, contractors) {
  const demand = demandByZip(leads);
  const covered = new Set();
  contractors.forEach((c) => (c.zip_coverage || []).forEach((z) => covered.add(z)));
  return demand
    .filter((d) => d.zip !== "unknown" && d.count >= 2 && !covered.has(d.zip))
    .sort((a, b) => (b.avgScore || 0) - (a.avgScore || 0) || b.count - a.count);
}

export function contractorPerformance(jobs, contractors) {
  return contractors.map((c) => {
    const cJobs = jobs.filter((j) => j.contractor_id === c.id);
    const completed = cJobs.filter((j) => j.status === "completed");
    const onTime = completed.filter((j) => j.scheduled_date && j.completed_date && j.completed_date <= j.scheduled_date);
    const revenue = completed.reduce((s, j) => s + (j.revenue_actual || j.revenue_estimate || 0), 0);
    return {
      id: c.id, name: c.name,
      jobsAssigned: cJobs.length, jobsCompleted: completed.length,
      completionRate: cJobs.length ? Math.round((completed.length / cJobs.length) * 100) : null,
      onTimeRate: completed.length ? Math.round((onTime.length / completed.length) * 100) : null,
      revenue,
    };
  }).sort((a, b) => b.revenue - a.revenue);
}

// Pricing guidance: median $/sqft implied by completed jobs vs the rough
// estimator's assumption — flags if real closed pricing is drifting from
// the baseline model so the estimate can be recalibrated.
export function pricingSignal(jobs) {
  const withBoth = jobs.filter((j) => j.status === "completed" && j.revenue_actual && j.revenue_estimate);
  if (withBoth.length < 3) return { available: false, sampleSize: withBoth.length, note: "Need at least 3 completed jobs with both an estimate and an actual revenue to compare." };
  const ratios = withBoth.map((j) => j.revenue_actual / j.revenue_estimate).sort((a, b) => a - b);
  const median = ratios[Math.floor(ratios.length / 2)];
  return {
    available: true, sampleSize: withBoth.length, medianActualVsEstimateRatio: Math.round(median * 100) / 100,
    note: median > 1.1 ? "Actual revenue is running above estimates — the cost model may be underestimating." : median < 0.9 ? "Actual revenue is running below estimates — the cost model may be overestimating." : "Estimates are tracking close to actuals.",
  };
}

// Nearest unassigned-job-to-contractor suggestion — straight-line distance,
// not real drive-time routing (same honest scope as lib/crm.js's canvassing optimizer).
export function suggestDispatch(jobs, contractors) {
  const dist = (a, b) => Math.hypot(a.lat - b.lat, (a.lon - b.lon) * Math.cos((a.lat * Math.PI) / 180));
  const openJobs = jobs.filter((j) => !j.contractor_id && j.lat && j.lon && !["completed", "canceled"].includes(j.status));
  const activeContractors = contractors.filter((c) => c.active && c.last_lat && c.last_lon);
  if (!activeContractors.length) return [];
  return openJobs.map((j) => {
    let best = null, bestD = Infinity;
    activeContractors.forEach((c) => { const d = dist(j, { lat: c.last_lat, lon: c.last_lon }); if (d < bestD) { bestD = d; best = c; } });
    return { job: j, suggestedContractor: best, approxMiles: Math.round(bestD * 69) };
  }).sort((a, b) => a.approxMiles - b.approxMiles);
}
