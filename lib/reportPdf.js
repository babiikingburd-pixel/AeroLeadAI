"use client";
// Builds a sales-ready inspection report PDF client-side (jsPDF, lazy
// imported so it never bloats the initial bundle). Includes damage summary,
// AI confidence, before/after imagery, AI-estimated roof measurements,
// estimated repair cost, and recent weather history — the same set of
// fields shown in the on-screen preview.
export async function generateReportPdf(report) {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const W = doc.internal.pageSize.getWidth();
  let y = 48;

  const amber = [245, 166, 35];
  doc.setFontSize(10); doc.setTextColor(...amber);
  doc.text("AEROLEADAI · PROPERTY INSPECTION REPORT", 40, y); y += 22;

  doc.setFontSize(18); doc.setTextColor(20, 20, 20);
  doc.text(report.address || "Property", 40, y); y += 20;
  doc.setFontSize(10); doc.setTextColor(100, 100, 100);
  doc.text(`Generated ${new Date().toLocaleString()}`, 40, y); y += 24;

  function heading(text) {
    doc.setFontSize(12); doc.setTextColor(...amber);
    doc.text(text, 40, y); y += 16;
    doc.setDrawColor(230, 230, 230); doc.line(40, y - 10, W - 40, y - 10);
  }
  function row(label, value) {
    doc.setFontSize(10); doc.setTextColor(90, 90, 90);
    doc.text(label, 40, y);
    doc.setTextColor(20, 20, 20);
    doc.text(String(value ?? "—"), 220, y);
    y += 16;
  }

  heading("Damage Summary & AI Confidence");
  row("Damage probability", report.findingsScore != null ? `${report.findingsScore}%` : "—");
  row("AI confidence", report.confidence || "—");
  row("Indicators", (report.indicators || []).join(", ") || "none recorded");
  if (report.notes) { doc.setFontSize(9); doc.setTextColor(90, 90, 90); doc.text(doc.splitTextToSize(`"${report.notes}"`, W - 80), 40, y); y += 28; }
  y += 8;

  if (report.measurements) {
    heading("AI-Estimated Roof Measurements (rough visual estimate)");
    row("Estimated area", report.measurements.estimated_area_sqft ? `${report.measurements.estimated_area_sqft} sq ft` : "—");
    row("Roof shape", report.measurements.roof_shape || "—");
    row("Facets", report.measurements.estimated_facets ?? "—");
    row("Pitch", report.measurements.estimated_pitch || "—");
    row("Estimate confidence", report.measurements.confidence || "—");
    y += 8;
  }

  if (report.scoring) {
    heading("Sales Intelligence");
    row("Roof age estimate", report.scoring.roof_age_estimate_years ? `${report.scoring.roof_age_estimate_years} yrs` : "—");
    row("Insurance claim probability", `${report.scoring.insurance_claim_probability_pct ?? "—"}%`);
    row("Estimated repair value", report.scoring.estimated_repair_value_usd ? `$${report.scoring.estimated_repair_value_usd.toLocaleString()}` : "—");
    row("Lead priority", report.scoring.lead_priority_rank || "—");
    y += 8;
  }

  if (report.weatherSummary) {
    heading("Weather History");
    doc.setFontSize(9); doc.setTextColor(20, 20, 20);
    doc.text(doc.splitTextToSize(report.weatherSummary, W - 80), 40, y); y += 28;
  }

  // Imagery — before/after (current + historical if available), side by side.
  const images = (report.imagery || []).slice(0, 2);
  if (images.length) {
    heading("Imagery");
    const imgW = (W - 80 - 12) / images.length;
    images.forEach((src, i) => {
      try { doc.addImage(src, "JPEG", 40 + i * (imgW + 12), y, imgW, imgW); } catch { /* skip unreadable image */ }
    });
    y += imgW + 16;
  }

  doc.setFontSize(8); doc.setTextColor(150, 150, 150);
  doc.text("AI-generated estimate. Not a substitute for a licensed inspector, adjuster, or measured takeoff.", 40, doc.internal.pageSize.getHeight() - 30);

  doc.save(`inspection-report-${(report.address || "property").replace(/\W+/g, "-").slice(0, 40)}.pdf`);
}
