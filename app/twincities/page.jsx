"use client";
import { useState, useCallback, useEffect } from "react";
import { HUD } from "../../lib/hudTheme";

const TIERS = [
  { key: "candidates", label: "Top 500 Candidates", cap: 500 },
  { key: "review", label: "Top 100 Human Review", cap: 100 },
  { key: "contractor", label: "Top 20 Contractor Package", cap: 20 },
];

const COUNTY_LABEL = { hennepin: "Hennepin", ramsey: "Ramsey", dakota: "Dakota", scott: "Scott", carver: "Carver", anoka: "Anoka" };

const REVIEW_COLOR = { pending: HUD.amber, approved: HUD.green, partial: HUD.cyan, rejected: HUD.red, needs_images: HUD.muted, contractor_sent: HUD.cyan };

export default function TwinCitiesPriorityPage() {
  const [tier, setTier] = useState("candidates");
  const [leads, setLeads] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [meta, setMeta] = useState(null);
  const [expanded, setExpanded] = useState(null);
  const [selected, setSelected] = useState({});
  const [contractorName, setContractorName] = useState("");
  const [exportStatus, setExportStatus] = useState(null);
  const [crawling, setCrawling] = useState(false);
  const [crawlStatus, setCrawlStatus] = useState(null);
  const [showingCache, setShowingCache] = useState(false);
  const [cacheTimestamp, setCacheTimestamp] = useState(null);

  const cacheKey = (t) => `twincities_cache_${t}`;

  // Load whatever's cached for this tier immediately (synchronous, instant,
  // works with zero network) — this is what keeps leads visible through
  // database hiccups, PostgREST schema-cache errors, or any other transient
  // /api/top-leads failure: none of it should blank the page that was
  // showing real data a moment ago. Only ever shows data that was real at
  // some point — never fabricated, never a placeholder.
  const loadFromCache = (t) => {
    try {
      const raw = localStorage.getItem(cacheKey(t));
      if (!raw) return false;
      const cached = JSON.parse(raw);
      setLeads(cached.leads || []);
      setMeta(cached.meta || null);
      setCacheTimestamp(cached.timestamp);
      setShowingCache(true);
      return true;
    } catch {
      return false;
    }
  };

  const saveToCache = (t, leadsData, metaData) => {
    try {
      localStorage.setItem(cacheKey(t), JSON.stringify({ leads: leadsData, meta: metaData, timestamp: Date.now() }));
    } catch {
      // localStorage full or unavailable (private browsing) — fail soft,
      // this is a resilience feature, it should never itself cause an error.
    }
  };

  const load = useCallback(async (t) => {
    setLoading(true);
    setError(null);
    const hadCache = loadFromCache(t); // show something immediately, before the network call even starts
    try {
      const res = await fetch(`/api/top-leads?tier=${t}`);
      const data = await res.json();
      if (data.ok) {
        setLeads(data.leads);
        setMeta({ scanned: data.scanned, entered: data.entered, cap: data.cap });
        setShowingCache(false);
        saveToCache(t, data.leads, { scanned: data.scanned, entered: data.entered, cap: data.cap });
      } else if (!hadCache) {
        // Only show the error if there's genuinely nothing to fall back to
        // — if cached data is already on screen, a live-fetch failure
        // shouldn't rip it away and replace it with a red error message.
        setError(data.error || data.note || "Unknown error");
        setLeads([]);
      }
    } catch (e) {
      if (!hadCache) setError(e.message);
      // else: silently keep showing the cached data already on screen —
      // the "showing cached data" banner already communicates this.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(tier); }, [tier, load]);

  async function setReviewStatus(id, status) {
    setLeads((cur) => cur.map((l) => (l.id === id ? { ...l, reviewStatus: status } : l)));
    await fetch("/api/lead-review", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status }),
    });
  }

  function toggleSelect(id) {
    setSelected((cur) => ({ ...cur, [id]: !cur[id] }));
  }

  async function fetchImages() {
    setCrawling(true);
    setCrawlStatus(null);
    try {
      const res = await fetch("/api/image-crawler?limit=25");
      const data = await res.json();
      if (data.ok) {
        setCrawlStatus({
          ok: true,
          message: data.note || `Processed ${data.processed} · Google ${data.google} · Mapbox ${data.mapbox} · Esri ${data.esri} · Failed ${data.failed}. Click again for the next batch.`,
        });
      } else {
        setCrawlStatus({ ok: false, message: data.error || "Image crawl failed." });
      }
    } catch (e) {
      setCrawlStatus({ ok: false, message: e.message });
    } finally {
      setCrawling(false);
    }
  }

  async function runEvidenceCycle() {
    setCrawling(true);
    setCrawlStatus({ ok: true, message: "Solidifying Top-500 evidence: imagery + permits + weather + rescoring…" });
    try {
      const res = await fetch("/api/twincities/evidence-cycle", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ limit: 8 }),
      });
      const data = await res.json();
      setCrawlStatus({
        ok: !!data.ok,
        message: data.ok
          ? `Evidence cycle processed ${data.processed}. Permits, weather and imagery persisted; rescoring triggered.`
          : (data.error || "Evidence cycle failed."),
      });
      if (data.ok) await load(tier);
    } catch (e) {
      setCrawlStatus({ ok: false, message: e.message });
    } finally {
      setCrawling(false);
    }
  }

  async function exportToContractor() {
    const leadIds = Object.keys(selected).filter((id) => selected[id]);
    if (!contractorName.trim() || leadIds.length === 0) {
      setExportStatus({ ok: false, message: "Enter a contractor name and select at least one lead." });
      return;
    }
    setExportStatus({ ok: null, message: "Exporting…" });
    const res = await fetch("/api/contractor-export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contractorName, leadIds, tier: `${tier}_${TIERS.find((t) => t.key === tier)?.cap}` }),
    });
    const data = await res.json();
    if (data.ok) {
      setExportStatus({ ok: true, message: `Exported ${leadIds.length} leads to ${contractorName}.` });
      setSelected({});
      load(tier);
    } else {
      setExportStatus({ ok: false, message: data.error || "Export failed." });
    }
  }

  return (
    <div style={{ minHeight: "100vh", background: HUD.bg, color: HUD.ice, fontFamily: HUD.fontMono, padding: "20px 24px" }}>
      <div style={{ marginBottom: 4, fontFamily: HUD.fontDisplay, fontSize: 20, fontWeight: 700, color: HUD.cyan, letterSpacing: "0.04em" }}>
        TWIN CITIES PRIORITY ENGINE
      </div>
      <div style={{ fontSize: 12, color: HUD.muted, marginBottom: 18 }}>
        Hennepin · Ramsey · Dakota · Scott · Carver · Anoka — Evidence Index v1.1, everything clickable, nothing requires opening Supabase.
      </div>

      <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
        {TIERS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTier(t.key)}
            style={{
              padding: "8px 16px", borderRadius: 4, cursor: "pointer", fontSize: 12, fontWeight: 700,
              border: `1px solid ${tier === t.key ? HUD.cyan : HUD.lineDim}`,
              background: tier === t.key ? "rgba(95,224,255,0.08)" : "transparent",
              color: tier === t.key ? HUD.cyan : HUD.muted,
            }}
          >
            {t.label}
          </button>
        ))}
        <button onClick={() => load(tier)} style={{ padding: "8px 16px", borderRadius: 4, cursor: "pointer", fontSize: 12, border: `1px solid ${HUD.lineDim}`, background: "transparent", color: HUD.green }}>
          ↻ Refresh
        </button>
        <button
          onClick={() => window.open("/twincities/contractor-prospects", "_blank", "noopener,noreferrer")}
          style={{ padding: "8px 16px", borderRadius: 4, cursor: "pointer", fontSize: 12, fontWeight: 700, border: `1px solid ${HUD.green}`, background: "rgba(61,220,151,0.08)", color: HUD.green }}
        >
          🏠 Contractor Prospects + Pitches
        </button>
        <button
          onClick={() => window.open("/twincities/apex10", "_blank", "noopener,noreferrer")}
          style={{ padding: "8px 16px", borderRadius: 4, cursor: "pointer", fontSize: 12, fontWeight: 700, border: `1px solid ${HUD.amber}`, background: "rgba(255,190,80,0.08)", color: HUD.amber }}
        >
          🎯 APEX 10 Report
        </button>
        <button
          onClick={runEvidenceCycle}
          disabled={crawling}
          style={{ padding: "8px 16px", borderRadius: 4, cursor: crawling ? "default" : "pointer", fontSize: 12, border: `1px solid ${HUD.cyan}`, background: "rgba(95,224,255,0.08)", color: HUD.cyan, opacity: crawling ? 0.6 : 1 }}
        >
          {crawling ? "🧠 Solidifying…" : "🧠 Solidify Top 500"}
        </button>
        <button
          onClick={fetchImages}
          disabled={crawling}
          style={{ padding: "8px 16px", borderRadius: 4, cursor: crawling ? "default" : "pointer", fontSize: 12, border: `1px solid ${HUD.lineDim}`, background: "transparent", color: HUD.amber, opacity: crawling ? 0.6 : 1 }}
        >
          {crawling ? "📷 Fetching Top 500…" : "📷 Top-500 Images (next 25)"}
        </button>
      </div>

      {crawlStatus && (
        <div style={{ fontSize: 11, color: crawlStatus.ok ? HUD.green : HUD.red, marginBottom: 12 }}>
          {crawlStatus.message}
        </div>
      )}

      {meta && (
        <div style={{ fontSize: 11, color: HUD.muted, marginBottom: 12 }}>
          Scanned {meta.scanned} · Entered Evidence Index {meta.entered} · Cap {meta.cap}
        </div>
      )}

      {showingCache && cacheTimestamp && (
        <div style={{ fontSize: 12, color: HUD.amber, marginBottom: 12, padding: "8px 12px", border: `1px solid ${HUD.amber}`, borderRadius: 4 }}>
          📴 Showing cached data from {new Date(cacheTimestamp).toLocaleString()} — live refresh {loading ? "in progress…" : "failed or hasn't run yet"}. This is real data from the last successful load, not placeholder content.
        </div>
      )}

      {loading && <div style={{ color: HUD.muted, fontSize: 13 }}>Scoring…</div>}
      {error && <div style={{ color: HUD.red, fontSize: 13, marginBottom: 12 }}>Error: {error}</div>}

      {tier === "contractor" && (
        <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 16, padding: 12, border: `1px solid ${HUD.lineDim}`, borderRadius: 4 }}>
          <input
            value={contractorName}
            onChange={(e) => setContractorName(e.target.value)}
            placeholder="Contractor name…"
            style={{ padding: "7px 10px", background: "transparent", border: `1px solid ${HUD.lineDim}`, borderRadius: 4, color: HUD.ice, fontSize: 12, minWidth: 200 }}
          />
          <button onClick={exportToContractor} style={{ padding: "8px 16px", borderRadius: 4, cursor: "pointer", fontSize: 12, fontWeight: 700, border: `1px solid ${HUD.green}`, background: "rgba(61,220,151,0.08)", color: HUD.green }}>
            Export selected ({Object.values(selected).filter(Boolean).length}) →
          </button>
          {exportStatus && <span style={{ fontSize: 12, color: exportStatus.ok ? HUD.green : exportStatus.ok === false ? HUD.red : HUD.muted }}>{exportStatus.message}</span>}
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {leads.map((lead) => (
          <div key={lead.id} style={{ border: `1px solid ${HUD.lineDim}`, borderRadius: 4, padding: "10px 14px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              {tier === "contractor" && (
                <input type="checkbox" checked={!!selected[lead.id]} onChange={() => toggleSelect(lead.id)} />
              )}
              {lead.imageUrl ? (
                <img
                  src={lead.imageUrl}
                  alt={lead.address}
                  style={{ width: 64, height: 64, objectFit: "cover", borderRadius: 4, flexShrink: 0, border: `1px solid ${HUD.lineDim}` }}
                />
              ) : (
                <div
                  title="No image yet"
                  style={{ width: 64, height: 64, flexShrink: 0, borderRadius: 4, border: `1px dashed ${HUD.lineDim}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, color: HUD.muted, textAlign: "center", padding: 4 }}
                >
                  no image yet
                </div>
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700 }}>{lead.address}</div>
                <div style={{ fontSize: 11, color: HUD.muted }}>{lead.city} · {COUNTY_LABEL[lead.county] || lead.county} County</div>
              </div>
              <div style={{ textAlign: "right", fontSize: 11, color: HUD.muted }}>
                Evidence <span style={{ color: HUD.ice, fontWeight: 700 }}>{lead.evidenceScore}</span> · Confidence <span style={{ color: HUD.ice, fontWeight: 700 }}>{lead.confidenceScore}%</span>
              </div>
              <div style={{ fontSize: 16, fontWeight: 700, color: HUD.cyan, minWidth: 60, textAlign: "right" }}>{lead.priorityScore}</div>
              <span style={{ fontSize: 10, fontWeight: 700, padding: "3px 8px", borderRadius: 10, color: REVIEW_COLOR[lead.reviewStatus] || HUD.muted, border: `1px solid ${REVIEW_COLOR[lead.reviewStatus] || HUD.muted}` }}>
                {lead.reviewStatus?.toUpperCase()}
              </span>
              <button onClick={() => setExpanded(expanded === lead.id ? null : lead.id)} style={{ padding: "5px 10px", fontSize: 11, cursor: "pointer", background: "transparent", border: `1px solid ${HUD.lineDim}`, borderRadius: 4, color: HUD.muted }}>
                {expanded === lead.id ? "Hide" : "Why?"}
              </button>
            </div>

            {expanded === lead.id && (
              <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${HUD.lineDim}`, display: "flex", gap: 20, flexWrap: "wrap", alignItems: "flex-start" }}>
                <div style={{ fontSize: 11, color: HUD.muted }}>
                  <div style={{ color: HUD.ice, fontWeight: 700, marginBottom: 4 }}>Evidence breakdown</div>
                  {Object.entries(lead.breakdown || {}).map(([k, v]) => (
                    <div key={k}>{k.replace(/_/g, " ")}: <span style={{ color: HUD.ice }}>{v}</span></div>
                  ))}
                  {(!lead.breakdown || Object.keys(lead.breakdown).length === 0) && <div>No breakdown recorded.</div>}
                </div>
                <div style={{ fontSize: 11, color: HUD.muted }}>
                  <div style={{ color: HUD.ice, fontWeight: 700, marginBottom: 4 }}>Assessed value</div>
                  {lead.assessedValue ? `$${lead.assessedValue.toLocaleString()}` : "Not enriched yet"}
                </div>
                <div style={{ display: "flex", gap: 6, marginLeft: "auto" }}>
                  <button onClick={() => setReviewStatus(lead.id, "approved")} style={{ padding: "6px 12px", fontSize: 11, fontWeight: 700, cursor: "pointer", border: `1px solid ${HUD.green}`, background: "transparent", color: HUD.green, borderRadius: 4 }}>Approve</button>
                  <button onClick={() => setReviewStatus(lead.id, "partial")} style={{ padding: "6px 12px", fontSize: 11, fontWeight: 700, cursor: "pointer", border: `1px solid ${HUD.cyan}`, background: "transparent", color: HUD.cyan, borderRadius: 4 }}>Partial</button>
                  <button onClick={() => setReviewStatus(lead.id, "needs_images")} style={{ padding: "6px 12px", fontSize: 11, fontWeight: 700, cursor: "pointer", border: `1px solid ${HUD.muted}`, background: "transparent", color: HUD.muted, borderRadius: 4 }}>Needs images</button>
                  <button onClick={() => setReviewStatus(lead.id, "rejected")} style={{ padding: "6px 12px", fontSize: 11, fontWeight: 700, cursor: "pointer", border: `1px solid ${HUD.red}`, background: "transparent", color: HUD.red, borderRadius: 4 }}>Reject</button>
                </div>
              </div>
            )}
          </div>
        ))}

        {!loading && leads.length === 0 && !error && (
          <div style={{ color: HUD.muted, fontSize: 13, padding: 20, textAlign: "center" }}>No leads in this tier yet.</div>
        )}
      </div>
    </div>
  );
}
