# AeroLeadAI — Autonomous scanning

A background job that builds your lead database on its own, without anyone
opening the batch console: it scans a ZIP code, scores the properties it
finds, saves them, then discovers neighboring ZIPs to expand into next time.
Point it at a starting ZIP and it works outward across a state over days/
weeks — "slowly but surely" is enforced by real limits below, not just a
figure of speech, because every address scored costs a real API call.

## Why this needs Supabase

Everything else in this app can fall back to your browser's localStorage.
This can't — a cron job runs on Vercel's servers with no browser attached,
so there is nowhere else to remember what's already been scanned. If you
don't have Supabase set up yet, this feature does nothing (the dashboard at
`/autonomous` will tell you so plainly rather than pretend to work).

## One-time setup

1. Confirm `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and
   `SUPABASE_SERVICE_ROLE_KEY` are all set in Vercel (Project Settings →
   Environment Variables). The service role key specifically is what lets
   the cron job write — the anon key alone can only read.
2. In Supabase's SQL Editor, run `supabase_autonomous_scan_schema.sql`
   (separate from the permits schema — this doesn't touch that table).
3. Set `CRON_SECRET` to any random string (e.g. `openssl rand -hex 32`) in
   Vercel env vars. Vercel Cron automatically sends this back as
   `Authorization: Bearer <value>` on every scheduled call, so the route can
   reject anyone else. Skipping this means the scan endpoint is triggerable
   by anyone who finds the URL — each trigger costs real API usage.
4. Optionally adjust `AUTO_SCAN_SEED_ZIP` / `AUTO_SCAN_SEED_STATE` (defaults
   to 55407 / MN) — this is only used once, to seed an empty queue.
5. Redeploy. `vercel.json` already defines the cron (`/api/auto-scan`, daily
   at 13:00 UTC) — Vercel picks it up automatically on deploy, no dashboard
   config needed. Hobby-plan accounts are limited to once-daily cron
   schedules; Pro allows more frequent if you want to speed this up.

## What happens each run

1. Pulls up to `AUTO_SCAN_ZIPS_PER_RUN` (default 1) pending ZIPs from the
   queue — the first run seeds the queue with your starting ZIP.
2. For each ZIP: scans it via the same OpenStreetMap Overpass lookup the
   interactive ZIP scanner uses, caps it at `AUTO_SCAN_ADDRESSES_PER_ZIP`
   (default 8) addresses, runs each through the permit/imagery/damage
   pipeline (skipping vision scoring for anything the 10-year permit rule
   already deprioritizes, same as the batch console), and upserts results
   into the `leads` table.
3. Averages the coordinates of what it found and searches outward
   (`AUTO_SCAN_NEIGHBOR_RADIUS_M`, default 9km) for nearby ZIPs still in the
   target state, queuing any not already known — this is how it expands
   across Minnesota over time without a hardcoded list of every MN ZIP.
4. Marks the ZIP done (or failed, with the reason) and stops.

## Why the defaults are conservative

- Every address scored calls the vision model (Groq/Anthropic) and the
  imagery provider (Google/Mapbox) — real cost and real rate limits, unlike
  the free OSM/USPS lookups elsewhere in this app.
- Vercel serverless functions have a hard execution time limit — `maxDuration`
  is set to 60s (the Hobby-plan ceiling) in `app/api/auto-scan/route.js`.
  Pushing `AUTO_SCAN_ADDRESSES_PER_ZIP` much higher risks the function
  timing out mid-run. If you're on Vercel Pro (300s+ limit), you can safely
  raise both `maxDuration` and the address cap.
- One ZIP/day means full Minnesota coverage (~900 ZIPs) is realistically a
  months-long process, by design — raise `AUTO_SCAN_ZIPS_PER_RUN` and the
  cron frequency together if you want it faster, but watch your Groq/Google/
  Mapbox usage as you do.

## Watching progress

`/autonomous` (linked from the batch console header) shows queue status
(pending/scanning/done/failed ZIPs), total leads found, and your current
hottest leads — reads directly from Supabase with the anon key, no
extra setup.

## Testing it without waiting for the cron

`GET /api/auto-scan` with the correct `Authorization: Bearer <CRON_SECRET>`
header runs one cycle immediately — useful for confirming the setup works
before waiting for the schedule.
