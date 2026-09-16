"use client";

import Image from "next/image";
import { useCallback, useEffect, useState } from "react";
import "./apex.css";
import PropertyIntelligence from "./PropertyIntelligence";

export default function ApexGridPage() {
  const [payload, setPayload] = useState(null);
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [limit, setLimit] = useState(100);

  const load = useCallback(async (nextLimit = limit) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/apex/properties?limit=${nextLimit}`, { cache: "no-store" });
      if (!res.ok) {
        setError(`Territory request failed (${res.status}).`);
        setPayload(null);
        return;
      }
      const data = await res.json();
      if (!data.ok) {
        setError(data.error || "Unable to load territory.");
        setPayload(null);
      } else {
        setPayload(data);
      }
    } catch (err) {
      setError(err?.message || "Network error.");
      setPayload(null);
    } finally {
      setLoading(false);
    }
  }, [limit]);

  useEffect(() => {
    load(limit);
  }, [load, limit]);

  const properties = payload?.properties || [];

  return (
    <main className="apex-shell">
      <header className="apex-header">
        <div>
          <div className="eyebrow">AEROLEADAI / APEX ENGINE</div>
          <h1>Property Intelligence Grid</h1>
          <p>
            {payload?.territory?.length
              ? `${payload.territory.join(", ")} · live evidence leaderboard`
              : "Live property evidence leaderboard"}
          </p>
          {payload?.generatedAt && (
            <p className="timestamp">
              Read {new Date(payload.generatedAt).toLocaleString()} · {payload.source}
            </p>
          )}
        </div>
        <div className="stats">
          <Stat label="TOP 100 ON FILE" value={payload?.top100Count ?? "—"} />
          <Stat label="TOP 500 ON FILE" value={payload?.top500Count ?? "—"} />
          <Stat label="LOADED" value={properties.length} />
          <Stat label="HUMAN REVIEW" value={properties.filter((p) => p.review).length} />
        </div>
      </header>

      <div className="controls">
        <button onClick={() => setLimit(100)} disabled={loading || limit === 100}>Load Top 100</button>
        <button onClick={() => setLimit(500)} disabled={loading || limit === 500}>Load Top 500</button>
        <button onClick={() => load(limit)} disabled={loading}>{loading ? "Scanning…" : "Refresh"}</button>
        <span className="control-note">Counts are live_rank on roof_profiles. Loaded cards are not a Top 500 by themselves.</span>
      </div>

      {loading && <div className="loading">Reading APEX scores…</div>}
      {error && (<div className="error-panel"><strong>Could not load territory.</strong><p>{error}</p></div>)}
      {!loading && !error && properties.length === 0 && (
        <div className="error-panel"><strong>No qualifying properties in this territory.</strong><p>Zero rows. Nothing is invented to fill the grid.</p></div>
      )}

      <section className="property-grid">
        {properties.map((property) => (
          <button key={property.id} className="property-card" onClick={() => setSelected(property)}>
            <div className="card-image">
              {property.imagery?.url ? (
                <Image src={property.imagery.url} alt={`Overhead property image for ${property.address}`} fill sizes="(max-width: 600px) 100vw, (max-width: 1000px) 50vw, 25vw" unoptimized />
              ) : (
                <div className="no-image"><span>—</span><small>Open stored image</small></div>
              )}
              <div className={`score score-${scoreClass(property.score)}`}>{property.score ?? "—"}</div>
            </div>
            <div className="card-body">
              <div className="rank">#{property.rank ?? property.displayIndex}{property.tier && <em> · {property.tier.toUpperCase()}</em>}</div>
              <h3>{property.address}</h3>
              <p>{property.city}, {property.state} {property.zip}</p>
              <div className="open-intel">OPEN + INSPECT →</div>
            </div>
          </button>
        ))}
      </section>
      {selected && <PropertyIntelligence property={selected} onClose={() => setSelected(null)} />}
    </main>
  );
}

function Stat({ label, value }) {
  return (<div className="stat"><span>{label}</span><strong>{value}</strong></div>);
}
function scoreClass(score) {
  if (score >= 70) return "hi";
  if (score >= 45) return "mid";
  return "lo";
}
