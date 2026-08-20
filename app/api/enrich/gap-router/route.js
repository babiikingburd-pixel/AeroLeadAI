import { supabaseServer } from "../../../../lib/supabaseServer";
export const dynamic = "force-dynamic";

// EVIDENCE GAP ROUTER
//
// Separates two questions the scoring engine was conflating:
//   "Who deserves attention?"  -> priority_score (the scorer's job)
//   "What's missing on them?"  -> this router
//
// A lead with a high score and unknown permit/storm status is not a weak
// lead — it's an UNINVESTIGATED one. This router finds those, works out
// which specific crawler would move the needle most, and ranks the work by
// expected return so a limited crawl budget goes where it changes rankings.
//
// GET  /api/enrich/gap-router?limit=500        -> preview routing, writes nothing
// POST /api/enrich/gap-router { limit, commit } -> persists gap_route/gap_priority

export const maxDuration = 120;

// DESIGN NOTE — why storm is not in this router:
// An earlier version included storm as a routable gap. Tested against live
// data (129,904 residential leads), it sent EVERY lead to storm_crawler and
// permit never won. Two structural reasons, both still worth remembering:
//   1. All leads shared an identical gap profile, so ROI ranking across
//      identical profiles collapses to a constant — the higher static weight
//      always wins. Per-lead routing only means something once profiles
//      actually diverge.
//   2. Storm and permit are not comparable units of work. One NOAA download
//      enriches all 130k leads at once (bulk, ~free). Permit lookup is a
//      per-address API call with real cost and rate limits (retail).
// Correct sequence: run bulk storm enrichment for everything FIRST, then use
// this router to allocate the scarce per-address budget among survivors.
// --- ROI weighting -------------------------------------------------------
//
// HONEST CAVEAT: gapValue and likelihood below are informed starting
// estimates, NOT learned parameters. There is no outcome data yet to fit
// them against (zero contractors onboarded, zero confirmed leads). They
// encode two defensible beliefs:
//   (a) permit status can DISQUALIFY a lead outright (a roof replaced 3
//       years ago is not a lead at any score), so resolving it has the
//       highest information value of any single field;
//   (b) storm evidence is what the product is fundamentally about, and it
//       currently has 0% coverage, so it's close behind.
// Revisit these once real outcomes exist — do not treat them as tuned.
// Storm is deliberately EXCLUDED from per-property routing. It is a bulk
// operation: one NOAA NCEI download enriches all 130k leads in a single
// pass at effectively zero per-property cost. Routing it per-lead through an
// ROI ranker is a category error — it made every single lead route to
// storm_crawler, which is what the earlier version of this file did.
// Storm belongs in /api/enrich/storm-backfill. This router allocates the
// SCARCE per-address budget only.
//
// HONEST CAVEAT: gapValue and likelihood are informed starting estimates,
// NOT learned parameters. There is no outcome data to fit them against yet
// (zero contractors onboarded, zero confirmed leads). Revisit once real
// outcomes exist — do not treat them as tuned.
const GAP_SPEC = {
  permit: {
    gapValue: 1.0,      // can disqualify outright -> highest information value
    likelihood: 0.55,   // Shovels/county coverage is real but patchy in MN
    sourceQuality: 0.9, // municipal/aggregator records are authoritative
    crawler: "permit_crawler",
    bulk: false,
  },
  value: {
    gapValue: 0.5,      // affects score but rarely flips a decision
    likelihood: 0.7,
    sourceQuality: 0.95,
    crawler: "property_crawler",
    bulk: false,
  },
  image: {
    gapValue: 0.6,      // needed for human confirmation, not for ranking
    likelihood: 0.9,
    sourceQuality: 0.7, // imagery age/quality varies a lot
    crawler: "image_crawler",
    bulk: false,
  },
};

const UNRESOLVED = new Set(["unknown", "failed"]);

// Evidence goes stale. A permit check from 8 months ago could be missing a
// permit pulled last month. Storm is intentionally absent here — it's
// event-driven (a specific historical storm date doesn't get "stale"), not
// time-decayed, and it's handled by the bulk backfill anyway.
const TTL_DAYS = { permit: 180, value: 90, image: 270 };

function isStale(status, checkedAt, ttlDays) {
  if (!checkedAt || status === "unknown" || status === "failed") return false; // "stale" only applies to evidence that was actually found
  const ageDays = (Date.now() - new Date(checkedAt).getTime()) / 86400000;
  return ageDays > ttlDays;
}

function analyzeGaps(row) {
  const gaps = [];
  const permitGap = UNRESOLVED.has(row.permit_evidence_status || "unknown")
    || isStale(row.permit_evidence_status, row.permit_checked_at, TTL_DAYS.permit);
  const valueGap = UNRESOLVED.has(row.value_evidence_status || "unknown")
    || isStale(row.value_evidence_status, row.value_checked_at, TTL_DAYS.value);
  const imageGap = (UNRESOLVED.has(row.image_evidence_status || "unknown")
    || isStale(row.image_evidence_status, row.image_fetched_at, TTL_DAYS.image)) && !permitGap;

  if (permitGap) gaps.push("permit");
  if (valueGap) gaps.push("value");
  if (imageGap) gaps.push("image");
  return gaps;
}

// Enrichment Priority = lead_score x gap_value x likelihood x source_quality
// Normalized by 100 so the output sits on a readable 0-1+ scale.
function gapPriority(leadScore, gapKey) {
  const s = GAP_SPEC[gapKey];
  return Math.round(((leadScore / 100) * s.gapValue * s.likelihood * s.sourceQuality) * 1000) / 1000;
}

function routeLead(row) {
  const gaps = analyzeGaps(row);
  if (!gaps.length) return null;

  // Route to the single highest-ROI gap. One lead, one crawler at a time —
  // resolving permit may disqualify the lead entirely, in which case
  // crawling storm/imagery for it would have been wasted work.
  const ranked = gaps
    .map((g) => ({ gap: g, priority: gapPriority(row.priority_score || 0, g) }))
    .sort((a, b) => b.priority - a.priority);

  const top = ranked[0];
  return {
    id: row.id,
    address: row.address,
    city: row.city,
    leadScore: row.priority_score,
    gaps,
    route: GAP_SPEC[top.gap].crawler,
    gapKey: top.gap,
    gapPriority: top.priority,
  };
}

async function loadCandidates(supabase, limit, minScore) {
  const { data, error } = await supabase
    .from("batch_leads")
    .select("id, address, city, priority_score, permit_evidence_status, permit_checked_at, value_evidence_status, value_checked_at, image_evidence_status, image_fetched_at")
    .eq("property_class", "likely_residential")
    .gt("priority_score", minScore)
    .order("priority_score", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return data || [];
}

export async function GET(req) {
  const supabase = supabaseServer();
  if (!supabase) return Response.json({ ok: false, error: "Supabase not configured." }, { status: 500 });

  const { searchParams } = new URL(req.url);
  const limit = Math.min(Number(searchParams.get("limit") ?? 500), 2000);
  const minScore = Number(searchParams.get("minScore") ?? 0);

  try {
    const rows = await loadCandidates(supabase, limit, minScore);
    const routed = rows.map(routeLead).filter(Boolean);

    const byRoute = {};
    for (const r of routed) {
      byRoute[r.route] = byRoute[r.route] || { count: 0, avgPriority: 0, sample: [] };
      byRoute[r.route].count++;
      byRoute[r.route].avgPriority += r.gapPriority;
      if (byRoute[r.route].sample.length < 3) byRoute[r.route].sample.push({ address: r.address, city: r.city, leadScore: r.leadScore, gapPriority: r.gapPriority });
    }
    for (const k of Object.keys(byRoute)) {
      byRoute[k].avgPriority = Math.round((byRoute[k].avgPriority / byRoute[k].count) * 1000) / 1000;
    }

    return Response.json({
      ok: true,
      mode: "preview",
      analyzed: rows.length,
      routed: routed.length,
      fullyEnriched: rows.length - routed.length,
      byRoute,
      topWork: routed.sort((a, b) => b.gapPriority - a.gapPriority).slice(0, 25),
      note: "Preview only — nothing written. POST with {commit:true} to persist routing.",
    });
  } catch (e) {
    return Response.json({ ok: false, error: e.message }, { status: 500 });
  }
}

export async function POST(req) {
  const supabase = supabaseServer();
  if (!supabase) return Response.json({ ok: false, error: "Supabase not configured." }, { status: 500 });

  let body = {};
  try { body = await req.json(); } catch {}
  const limit = Math.min(body.limit ?? 500, 5000);
  const minScore = body.minScore ?? 0;
  if (body.commit !== true) {
    return Response.json({ ok: false, error: "Refusing to write without {commit:true}. Use GET to preview first." }, { status: 400 });
  }

  try {
    const rows = await loadCandidates(supabase, limit, minScore);
    const routed = rows.map(routeLead).filter(Boolean);
    const now = new Date().toISOString();

    let written = 0;
    for (const r of routed) {
      // Writing gap_route/gap_priority alone was the disconnect: the worker
      // only ever reads enrichment_queue/enrichment_status, so routing
      // decisions never reached it. The router now enqueues directly, so
      // gap analysis actually drives what gets crawled — and the worker
      // orders by gap_priority so the highest-ROI work runs first.
      const { error } = await supabase.from("batch_leads").update({
        gap_route: r.route,
        gap_priority: r.gapPriority,
        gap_computed_at: now,
        enrichment_queue: "priority",
        enrichment_status: "pending",
        enrichment_queued_at: now,
        score_before_enrichment: r.leadScore,
      })
        .eq("id", r.id)
        // Never stomp a job another worker already claimed or finished.
        .or("enrichment_status.is.null,enrichment_status.eq.pending");
      if (!error) written++;
    }

    return Response.json({
      ok: true, mode: "commit", analyzed: rows.length,
      routed: routed.length, enqueued: written,
      note: "Leads routed AND enqueued. Run /api/enrich/priority-worker to drain the queue.",
    });
  } catch (e) {
    return Response.json({ ok: false, error: e.message }, { status: 500 });
  }
}
