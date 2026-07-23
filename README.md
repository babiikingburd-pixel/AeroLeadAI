# AeroLeadAI Property Intelligence — Deployable Build

Full CEO Agent hierarchy, wired to run on your own domain, with every
improvement from the last round built in.

## Run free today, upgrade to Claude tomorrow

Every Claude call now goes through `lib/aiClient.js`, which auto-selects
the provider:
- **`GROQ_API_KEY` set, no `ANTHROPIC_API_KEY`** → runs on Groq's free
  vision model (`llama-4-scout`), no credit card needed
- **`ANTHROPIC_API_KEY` set** → runs on Claude automatically, regardless
  of whether Groq is also set

So: get a free key at console.groq.com right now (API Keys in the left
sidebar, no billing required), drop it in as `GROQ_API_KEY`, and the whole
pipeline runs today. Tomorrow, once billing is set up, add
`ANTHROPIC_API_KEY` and redeploy — every agent silently upgrades to Claude,
zero code changes.

**Honest quality note:** Groq's vision model is labeled "Preview" by Groq
themselves — it's a real, working stand-in for testing the full pipeline
end-to-end (uploads, scoring, verification, findings), but expect less
nuanced damage detection than Claude gives. The Agent Control Center shows
which provider answered each call (`[groq]` or `[anthropic]`) so you can
see exactly what ran where. Free tier is also rate-limited (~30
requests/minute), and multi-run averaging (below) uses 3 calls per
analysis, so it'll hit that limit faster than a single-call setup would.

## What's in this version

- **Damage Analyst + Verification Officer** for Roof/Tree/Driveway: real
  vision calls via `/api/damage-agent` and `/api/verify-agent`
- **Weather Analyst**: real live NWS forecast via `/api/weather-agent`
  (server-side — this is what fixes the artifact-sandbox bug)
- **Multi-run averaging**: when the Analyst's confidence is low or the
  score lands in an ambiguous 20–80 range, it automatically runs 2 more
  passes and averages them instead of trusting one uncertain read. Costs
  a bit more on borderline cases, cheap on clear ones.
- **temperature: 0** on every call for consistent scoring
- **Auth, two modes**:
  - If `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` are
    set, you get real email magic-link sign-in.
  - If not set, it falls back to the shared password gate
    (`ACCESS_PASSWORD` at the top of the component — change before deploy).
- **Storage, two modes**: same pattern — Supabase if configured (real
  cross-device sync, per-user data), localStorage if not (works
  immediately, single device only).
- **Structural Analyst** now factors in roof pitch (low-slope roofs hold
  snow longer) alongside weather and building age. Still rule-based — see
  gaps below.
- **Manual data entry** for Permits, Inspection Reports, Contractor Notes,
  and Repairs — no live connector exists for county records or drone
  imagery yet (needs a chosen vendor + API key, your call which one), so
  this is the honest, working alternative: log it yourself, it persists.
- **Demo Property button**: preloaded with your real 4243 13th Ave S photos.

## Supabase setup (optional — skip this section to just use localStorage/password)

1. In your Supabase project's SQL editor, run `supabase_propintel_state_schema.sql`
   (repo root) — backs the main console's cross-device sync. `supabase_permits_schema.sql`
   and `supabase_batch_leads_schema.sql` are separate, also-optional pieces (permit
   directory, batch queue/imagery cache) — see their own sections below.
2. In Supabase Auth settings, make sure email OTP / magic link is enabled
   (it is by default).
3. Add to your env vars (both locally in `.env.local` and in Vercel):
   ```
   NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
   ```
4. Redeploy. The app detects these automatically and switches from
   password+localStorage to magic-link+Supabase — no code changes needed.

### Batch console ZIP-scan queue + imagery cache (optional — separate from the above)

The `/batch` Mass Upload console's ZIP-code-search queue, and the imagery
cache/history behind before/after comparison, default to
localStorage/in-memory (single browser or single warm serverless instance).
To make them durable, run `supabase_batch_leads_schema.sql` in the same
Supabase project's SQL editor (creates `batch_leads`, `imagery_cache`, and
`imagery_history`), using the same `NEXT_PUBLIC_SUPABASE_URL` /
`NEXT_PUBLIC_SUPABASE_ANON_KEY` vars above. Full-size images stay
client-side either way (re-fetched free on demand) — only lightweight
records are stored server-side.

## Deploy steps (Vercel, ~10 minutes)

1. Get an Anthropic API key at console.anthropic.com if you don't have one.
2. Push this folder to a new GitHub repo.
3. Import into Vercel (vercel.com -> Add New -> Project).
4. Add environment variable `ANTHROPIC_API_KEY` (required). Add the two
   Supabase vars too if you did that setup (optional).
5. Deploy — standard Next.js app, no special build config.
6. Optional: connect your domain under Project Settings -> Domains.
7. On your phone: open the URL, "Add to Home Screen."

## Local testing (do this before deploying, per your plan)

```
npm install
cp .env.example .env.local   # paste your real Anthropic key in
npm run dev
```
Open http://localhost:3000 — every agent call is real, so this is a true
test, not a mockup.

## Known gaps, carried forward honestly

- Structural (snow load) Analyst is still rule-based (weather + age +
  pitch) — real load calculations need actual engineering data
  (load rating, snow-water-equivalent) that isn't wired in.
- No live connector for permits, drone imagery, street imagery, or
  historical records — those need a chosen paid vendor and API key, which
  is a business decision (which county GIS / imagery provider), not
  something to pick for you. Manual entry covers the gap for now.
- Password gate (fallback mode) is not real per-user auth — fine for solo
  use or early demos, use the Supabase magic-link mode before sharing
  broadly.
- Not yet tested against a live Vercel deployment with a real key — your
  local test run is the first real end-to-end check.


## v2 upgrades (this build)

1. **Autonomous address detection** — "📍 Use my location" in the Console: browser GPS → server reverse-geocode (`/api/reverse-geocode`, Census + Nominatim, cached) → search box auto-fills. Falls back to ZIP if GPS is denied or no street resolves.
2. **Background AI Lead Scanner** (`/scanner`) — enter a ZIP, it discovers real addresses, queues them, and auto-processes (geocode → satellite tile → roof scoring) with pacing. Completed scans are cached in `aeroleadai_scan_cache_v1`, so repeat requests are instant, and every result feeds the shared lead store.
3. **Performance** — the Lead Map is lazy-loaded (`next/dynamic`, ssr:false); geocode, ZIP discovery, and imagery responses are TTL-cached server-side (duplicate geocoding requests never re-hit upstream); Esri imagery is JPEG-compressed at quality 70; `lite: true` on `/api/imagery-agent` skips the street sweep for batch speed.
4. **Dashboard** (`/dashboard`) — KPI cards (properties scanned, damage detected, active leads, estimated pipeline revenue, avg AI confidence), score-distribution and status charts, min-score + status filtering, click any lead for its full AI assessment.
5. **AI Confidence & Explainability** — every lead shows damage probability, the specific indicators the model flagged, a confidence percentage, and supporting imagery (ConfidenceCard).
6. **Security** — `middleware.js` rate-limits every `/api/*` route per IP (tighter caps on expensive AI/imagery routes) and logs every request as structured JSON; all routes validate inputs (address length, lat/lon ranges, 5-digit ZIP, ≤8MB image payloads); all secrets are env-only (see `.env.example`).
7. **CRM & Workflow** (`/crm`) — one-click CSV export, per-lead status tracking (new → contacted → quoted → won/lost), follow-up dates with overdue alerts, nearest-neighbor canvassing route that opens directly in Google Maps, and HubSpot/Salesforce sync via `HUBSPOT_WEBHOOK_URL` / `SALESFORCE_WEBHOOK_URL`.

Console, Batch, and Scanner all write into one shared lead store (`aeroleadai_leads_v1`), so the Dashboard and CRM always reflect everything you've scanned.

## v3 upgrades (roadmap items 1-7)

1. **Autonomous Property Discovery** (`/discovery`) — search by ZIP, city, county, or draw an area directly on the map (click 3+ points). Every match is queued through the Background Processing Engine: reverse geocode → imagery → AI damage scan → auto-added to the CRM. One click from search to lead generation.
2. **Interactive Damage Intelligence Map** (`/map`, rewritten) — color-coded pins, automatic clustering for dense areas, a toggleable heat-map layer, live score/status/text filtering, and clicking a property opens the full Lead Detail drawer (not just a summary card).
3. **AI Inspection & Report Generator** — `/api/measure-roof` (AI-estimated roof area/shape/pitch — labeled as a rough visual estimate, not a takeoff) plus a "Generate inspection report" button (in the Lead Detail drawer's Report tab) that produces a downloadable PDF: damage summary, confidence, before/after imagery, measurements, weather history.
4. **Advanced CRM Automation** — the Lead Detail drawer (click any address in the CRM, Dashboard, or Map) now has full tabs: Notes (timestamped log), Tasks (with due dates), Calendar (.ics download for the follow-up date, works with Google/Outlook/Apple), and Communications (email/SMS logging, with optional real send via `EMAIL_WEBHOOK_URL`/`SMS_WEBHOOK_URL`).
5. **Background Processing Engine** (`/jobs`, `lib/jobQueue.js`) — a real persisted job queue behind Discovery and the Background Scanner: progress tracking, pause/resume, automatic retries (2 attempts) on failure, resumes automatically if you close the tab mid-run, and browser notifications when a run finishes.
6. **Multi-Source Imagery Intelligence** — `/api/imagery-agent` now tries Nearmap → Google → Mapbox → Planet/Sentinel (historical-capable) → Esri free, automatically, falling through on failure. Historical before/after comparison (`ImageryCompare.jsx` slider) works when `PLANET_API_KEY` is set; otherwise it says so honestly instead of faking a comparison.
7. **AI Lead Scoring & Sales Intelligence** — `/api/lead-score` produces roof age estimate, damage severity, insurance claim probability, estimated repair value, and a priority rank (Lead Detail drawer's Scoring tab). The Dashboard's revenue KPI now risk-adjusts by claim probability for every AI-scored lead instead of a flat average.

New env vars (all optional, all with honest fallbacks): `NEARMAP_API_KEY`, `PLANET_API_KEY`, `SENTINEL_HUB_CLIENT_ID`/`SENTINEL_HUB_CLIENT_SECRET`, `EMAIL_WEBHOOK_URL`, `SMS_WEBHOOK_URL`. See `.env.example`.

## v4 upgrades (Property Intelligence, Ops, BI, Customer Portal)

Run `supabase_ops_schema.sql` for the `contractors` and `jobs` tables behind
these four — Property Intelligence's job creation, Ops Center, BI Engine,
and the Customer Portal all need it. No new env vars; everything reuses the
AI/imagery/Supabase keys already configured.

1. **Property Intelligence Engine** (Lead Detail drawer → Profile tab) — combines imagery, weather, permits, and an AI roof measurement already on the lead into one profile, then computes (free, instant, no AI call) a replacement-cost estimate, a deterministic risk score, and an auto-qualification tier via `lib/propertyIntelligence.js` — complements rather than duplicates the AI-based `/api/lead-score`. Also shows AI-annotated damage bounding boxes (`/api/damage-annotate`, `RoofAnnotationViewer.jsx`) drawn directly on the property image. Parcel/ownership data is honestly not included — that needs a county GIS API, a vendor decision. From here you can create a job + generate a Customer Portal link.
2. **Autonomous Operations Command Center** (`/ops`) — national map of jobs (color-coded by status) and contractors, revenue (completed vs. pipeline), a live system-health self-check (AI provider, imagery provider, Supabase, and real pings to Overpass/Nominatim/NWS), weather alerts for active job locations, average AI confidence, and an exception queue computed from real conditions (unassigned active jobs, high-score-but-low-confidence leads, overdue schedules) — not a simulated alert feed. Contractor locations are manually set / last check-in, not live GPS (needs a mobile app or phone location source — a product decision). AI voice activity isn't included (no telephony vendor configured).
3. **AI Business Intelligence Engine** (`/intelligence`) — demand by ZIP, a revenue trend (honestly reports "insufficient data" under ~4 completed jobs instead of faking a forecast), underserved-market/contractor-recruiting targets (lead volume vs. contractor ZIP coverage), a pricing signal (actual vs. estimated revenue ratio on completed jobs), contractor performance (completion rate, on-time rate, revenue), and straight-line dispatch suggestions. All computed from your own data (`lib/businessIntelligence.js`) — no simulated numbers, and small-sample caveats are surfaced, not hidden. No automated model retraining loop (that needs real completed-job volume to be worth building) — this tracks calibration (estimate vs. actual) rather than claiming to self-improve.
4. **Customer Intelligence Portal** (`/portal/[token]`, partial) — token-gated (not the internal password/magic-link gate — homeowners aren't staff), shows the instant estimate, AI damage score, property history timeline, and an AI chat grounded in that specific job's real data (`/api/portal-chat`) so it can't invent scheduling/pricing details. Live technician tracking, digital contracts, and in-app payments are clearly labeled as needing a GPS/location source, an e-signature vendor, and a payment processor respectively — stubbed honestly, not faked, since those are vendor/account decisions this can't make for you.

### What's deliberately NOT included (needs a business/vendor decision first)
- **In-app payments** — needs a Stripe (or similar) account; real money movement and PCI compliance aren't something to wire up speculatively.
- **Live GPS technician tracking** — needs a mobile app or phone-based location source.
- **AI voice** — needs a telephony/voice vendor (e.g. Bland.ai, Twilio); a real account and cost commitment.
- **Digital e-signature contracts** — needs a DocuSign-style vendor.
- **Insurance/property-management integrations, franchise/territory management, white-label, multi-region scaling** — these are business partnerships and a multi-tenancy redesign, not something to code speculatively without those relationships in place.

## v5 upgrades (Phase 2 — Growth, Marketing, Quality, Property Records, Enterprise/Developer Platform)

Run `supabase_phase2_schema.sql` for all of this — it adds
`contractor_candidates`, `campaigns`, `job_audits`, `property_records`,
`organizations`/`organization_users`, `escrow_holds`, `subscriptions`,
`api_keys`, `webhook_subscriptions`, `region_launches`, and
`decisions`/`decision_reports` (used by the Executive Engine below), plus a
few columns on `contractors`/`batch_leads`/`jobs`. No new env vars — Stripe-
dependent pieces (escrow, contractor subscriptions) stay at
`{available:false}` until `STRIPE_SECRET_KEY` exists.

1. **Contractor Growth Engine** (`lib/growth/recruiter.js`, surfaced in `/intelligence`) — candidate submission, license/insurance verification (honest "no provider configured" until you wire one in), onboarding into `contractors`, and a monitoring sweep that suspends contractors on expired insurance or a >50% cancellation rate over 5+ jobs.
2. **AI Sales & Marketing Engine** (`/crm` → Marketing Campaigns panel) — campaign records by channel/ZIP/budget, a nurture sweep over new/contacted leads, and a budget-reallocation signal computed from real conversion — actually placing ad spend needs `GOOGLE_ADS_API_KEY`/`META_ADS_API_KEY` (not configured), so it logs the recommendation instead of spending money.
3. **Quality Assurance loop** (`/ops` → Quality Flags panel) — `auditCompletedJob` compares the AI damage summary captured at job creation against a post-completion photo and flags a mismatch for review; satisfaction scores and flagged-job review are wired in too.
4. **Property Intelligence history** (`lib/property/propertyRecord.js`, `/api/property/records`) — a per-property timeline (inspections, repairs, damage events) independent of any single lead/job record.
5. **Strategic Advisor + Expansion Playbook + Contractor Benchmarks** (`/intelligence`, bottom panel) — recruitment-target and market-entry recommendations from real ZIP-level demand/supply gaps, a 9-step region-launch checklist tracker, and contractor/regional performance benchmarks — all confidence-labeled since they're naturally sparse until there's more data.
6. **Enterprise & Developer Platform** (`/enterprise`) — organizations (municipalities, property managers, HOAs, insurers) manage a portfolio of properties and get a spend/open-jobs/flagged-jobs report; scoped API keys (`lib/platformApi.js`) gate a public read endpoint (`GET /api/v1/properties/:id`) to one organization's data.
7. **Financial reporting** (`lib/financial/financialServices.js`, surfaced on `/enterprise`) — real platform-wide revenue/job-count reporting from the `jobs` table today; escrow, contractor subscriptions, and customer financing are honest `{available:false}` stubs until `STRIPE_SECRET_KEY`/`FINANCING_PARTNER_API_KEY` exist (the real Stripe call shape is commented inline for when they do).

## v6 upgrade (AI Executive Engine — Boardroom)

No new SQL beyond `supabase_phase2_schema.sql` above (it already includes
`decisions`/`decision_reports`). Uses whichever AI provider is already
configured (`GROQ_API_KEY` or `ANTHROPIC_API_KEY`) — no separate vendor
account.

A portable multi-agent "executive team" (`lib/executive/`) that reasons
about the business the same way a human leadership team would, adapted from
a standalone engine to plug into AeroLeadAI's actual schema instead of
running its own:

- **CFO/COO/CMO/CLO/CSO agents** each analyze one real domain — financials
  (from `jobs`), operations (`jobs`/`batch_leads` pipeline), marketing
  (`campaigns`/lead conversion), legal/compliance (contractor licensing/
  insurance expiry), and strategy (lead volume by ZIP) — and return a
  structured recommendation with a risk level and confidence.
- **CEO agent** convenes the five and synthesizes one executive summary —
  available as a quick, no-vote "advisory" mode (`/executive` → Ask the
  Executive Team) for "how healthy is the business" style questions.
- **Formal decisions** (`/executive` → Propose a Decision) add a mandatory-
  dissent **"Fifth Business"** agent whose default vote is NO — it must
  raise a real, specific objection every round or switch to yes. The team
  negotiates up to 3 rounds; unanimous agreement approves the action,
  otherwise it escalates to a human. Any single "high risk" recommendation
  force-escalates immediately, regardless of vote count.
- **Governance**: every decision runs in **dry-run by default** — nothing is
  ever auto-executed against the business. A stuck (escalated) decision can
  get a **second opinion** from a fresh council (informational only — never
  auto-applied) before a human calls `resolveByHuman`. Decisions can
  `dependsOn` another decision and are blocked (not silently run) while that
  dependency is stuck, so two contradictory approvals never land downstream
  of an unresolved one.
- **Tamper-evident audit trail**: every escalation/second-opinion/resolution
  writes a markdown report to the `decision_reports` table, which has no
  update/delete RLS policy — a written report can't be edited after the
  fact, the Supabase equivalent of the original engine's read-only file.
- **Explicitly not built**: the source package also included a standalone
  Android app shell and a long-running Node server with in-memory state.
  Both are architecturally incompatible with Vercel's stateless serverless
  functions (no persistent process, no app-store publishing pipeline in
  scope) and were left out — the Boardroom is reachable through `/executive`
  and its API routes instead.
