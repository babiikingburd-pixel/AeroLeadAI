"use client";

import { useCallback, useEffect, useState } from "react";
import "./apex.css";
import "./inspect.css";
import PropertyIntelligence from "./PropertyIntelligence";

export default function ApexGridPage() {
  const [payload, setPayload] = useState(null);
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [contractor, setContractor] = useState("apex roofing");
  const [draft, setDraft] = useState("apex roofing");

  const load = useCallback(async (name) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/apex/properties?contractor=${encodeURIComponent(name)}&limit=24`,
        { cache: "no-store" }
      );
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
  }, []);

  useEffect(() => {
    load(contractor);
  }, [contractor, load]);

  const properties = payload?.properties || [];

  return (
    <main className="apex-shell">
      <header className="apex-header">
        <div>
          <div className="eyebrow">AEROLEADAI / APEX ENGINE</div>
          <h1>Property Intelligence Grid</h1>
          <p>
            {payload?.contractor?.businessName
              ? `${payload.contractor.businessName} · ${(payload.territory || []).join(", ")}`
              : "Territory scoring from batch_leads"}
          </p>
          {payload?.generatedAt && (
            <p className="timestamp">
              Live read {new Date(payload.generatedAt).toLocaleString()} ·{" "}
              {payload.eagleView?.configured
                ? `EagleView ${payload.eagleView.environment} (${payload.eagleView.authMode})`
                : "EagleView not configured — imagery on inspect"}
            </p>
          )}
        </div>

        <div className="stats">
          <Stat label="TERRITORY LEADS" value={properties.length} />
          <Stat label="TOP 500" value={properties.filter((p) => p.tier === "top500").length} />
          <Stat label="HUMAN REVIEW" value={properties.filter((p) => p.review).length} />
        </div>
      </header>

      <div className="controls">
        <label htmlFor="contractor-input">Contractor</label>
        <input
          id="contractor-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") setContractor(draft.trim() || "apex roofing");
          }}
          placeholder="apex roofing"
        />
        <button
          onClick={() => {
            const name = draft.trim() || "apex roofing";
            setContractor(name);
            load(name);
          }}
          disabled={loading}
        >
          {loading ? "Scanning…" : "Refresh"}
        </button>
        <a className="back-link" href="/twincities/contractor-prospects">
          ← Contractor Prospect Bench
        </a>
      </div>

      {loading && <div className="loading">Reading live APEX scores…</div>}

      {error && (
        <div className="error-panel">
          <strong>Could not load territory.</strong>
          <p>{error}</p>
        </div>
      )}

      {!loading && !error && properties.length === 0 && (
        <div className="error-panel">
          <strong>No qualifying properties in this territory.</strong>
          <p>The engine returned zero rows for this service area. Nothing is invented to fill the grid.</p>
        </div>
      )}

      <section className="property-grid">
        {properties.map((property) => (
          <button key={property.id} className="property-card" onClick={() => setSelected(property)}>
            <div className="card-image">
              {property.imagery?.url ? (
                <img src={property.imagery.url} alt={property.address} loading="lazy" />
              ) : (
                <div className="no-image">
                  <span>—</span>
                  <small>Open to inspect</small>
                </div>
              )}
              <div className={`score score-${scoreClass(property.score)}`}>{property.score ?? "—"}</div>
              <div className={`imagery-tag tag-${property.imagery?.source}`}>
                {property.imagery?.source === "eagleview"
                  ? "EAGLEVIEW"
                  : property.imagery?.source === "esri"
                    ? "ESRI"
                    : "NO IMAGE"}
              </div>
            </div>
            <div className="card-body">
              <div className="rank">
                #{property.displayIndex}
                {property.tier === "top500" && <em> · TOP500</em>}
              </div>
              <h3>{property.address}</h3>
              <p>
                {property.city}, {property.state} {property.zip}
              </p>
              <div className="mini-data">
                <span>
                  Built<strong>{property.yearBuilt ?? "Unknown"}</strong>
                </span>
                <span>
                  Storm
                  <strong>
                    {property.stormExposure?.hailInches
                      ? `${property.stormExposure.hailInches}" hail`
                      : property.stormExposure?.windMph
                        ? `${property.stormExposure.windMph} mph`
                        : "None"}
                  </strong>
                </span>
                <span>
                  Confidence<strong>{property.confidence ?? "—"}</strong>
                </span>
              </div>
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
  return (
    <div className="stat">
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}
function scoreClass(score) {
  if (score == null) return "none";
  if (score >= 85) return "hot";
  if (score >= 70) return "warm";
  return "cool";
}
