"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";

export default function ContractorReport() {
  const params = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetch(`/api/reports/${params.contractor}`)
      .then((r) => r.json())
      .then((d) => (d.ok ? setData(d) : setError(d.error || "Unable to load report.")))
      .catch((e) => setError(e.message));
  }, [params.contractor]);

  return (
    <main style={{ maxWidth: 1000, margin: "0 auto", padding: 28, fontFamily: "Arial, sans-serif", color: "#111", background: "#fff" }}>
      <div className="no-print" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <a href="/twincities">← Twin Cities Engine</a>
        <button onClick={() => window.print()} style={{ padding: "10px 16px", fontWeight: 700, cursor: "pointer" }}>Print / Save PDF</button>
      </div>

      <header style={{ borderBottom: "2px solid #111", paddingBottom: 16, marginBottom: 20 }}>
        <div style={{ fontSize: 12, letterSpacing: 2, fontWeight: 700 }}>AEROLEADAI · PRIVATE DEMO</div>
        <h1 style={{ margin: "8px 0 4px", fontSize: 30 }}>
          {data ? data.contractor.toUpperCase() : "…"} — TOP {data ? data.limit : ""} OPPORTUNITIES
        </h1>
        <div style={{ color: "#555" }}>
          {data ? data.serviceArea.join(", ") : ""} · generated {data ? new Date(data.generatedAt).toLocaleString() : "…"}
        </div>
      </header>

      <div style={{ padding: 14, background: "#f4f4f4", border: "1px solid #ddd", marginBottom: 20 }}>
        <strong>Important:</strong> These are prioritized inspection opportunities based on available property and storm evidence. They are <strong>not claims that a roof is damaged</strong>. A contractor should independently verify conditions before contacting an owner.
      </div>

      {error && <div style={{ color: "#b00020" }}>Error: {error}</div>}
      {!data && !error && <div>Loading the strongest opportunities…</div>}

      {data && (
        <>
          <div style={{ display: "flex", gap: 24, marginBottom: 22, fontSize: 14 }}>
            <div><strong>{data.leads.length}</strong> opportunities</div>
            <div><strong>{data.scanned}</strong> properties screened</div>
          </div>

          {data.leads.map((lead, i) => (
            <section key={lead.id} style={{ border: "1px solid #ccc", borderRadius: 6, padding: 18, marginBottom: 12, breakInside: "avoid" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 20 }}>
                <div>
                  <div style={{ fontSize: 12, color: "#666" }}>#{i + 1} · {lead.city}, {lead.county}</div>
                  <h2 style={{ margin: "4px 0", fontSize: 19 }}>{lead.address}</h2>
                  <a href={lead.mapUrl} target="_blank" rel="noreferrer">Open property in Google Maps</a>
                </div>
                <div style={{ textAlign: "right", minWidth: 90 }}>
                  <div style={{ fontSize: 28, fontWeight: 800 }}>{lead.priorityScore}</div>
                  <div style={{ fontSize: 11, color: "#666" }}>PRIORITY</div>
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginTop: 14, fontSize: 13 }}>
                <div><strong>Built</strong><br />{lead.yearBuilt || "Unknown"}</div>
                <div><strong>Value</strong><br />{lead.assessedValue ? `$${Number(lead.assessedValue).toLocaleString()}` : "Not enriched"}</div>
                <div><strong>Hail</strong><br />{lead.hailInches != null ? `${lead.hailInches}"` : "No data"}</div>
                <div><strong>Wind</strong><br />{lead.windMph != null ? `${lead.windMph} mph` : "No data"}</div>
              </div>
              <div style={{ marginTop: 12, fontSize: 12, color: "#444" }}>
                Evidence: {lead.evidenceScore} · Confidence: {lead.confidenceScore}% · Route: {lead.route || "—"}
                {lead.stormDate ? ` · Storm: ${lead.stormDate}` : ""}
              </div>
            </section>
          ))}

          {data.leads.length === 0 && <div>No qualifying opportunities were found in the current database. This report does not fabricate addresses.</div>}
        </>
      )}

      <style dangerouslySetInnerHTML={{ __html: "@media print { .no-print { display:none !important; } body { margin:0; } a { color:#111; text-decoration:none; } }" }} />
    </main>
  );
}
