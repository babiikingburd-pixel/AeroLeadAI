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

1. In your Supabase project's SQL editor, run:
   ```sql
   create table propintel_state (
     key text not null,
     value text not null,
     user_id uuid references auth.users(id),
     updated_at timestamptz default now(),
     primary key (key, user_id)
   );
   alter table propintel_state enable row level security;
   create policy "Users manage their own state" on propintel_state
     for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
   ```
2. In Supabase Auth settings, make sure email OTP / magic link is enabled
   (it is by default).
3. Add to your env vars (both locally in `.env.local` and in Vercel):
   ```
   NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
   ```
4. Redeploy. The app detects these automatically and switches from
   password+localStorage to magic-link+Supabase — no code changes needed.

### Batch console ZIP-scan queue (optional — separate from the above)

The `/batch` Mass Upload console's ZIP-code-search queue defaults to
localStorage (single browser only). To make it durable across
devices/sessions, run `supabase_batch_leads_schema.sql` in the same
Supabase project's SQL editor, then set the same
`NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` vars above.
Images stay client-side either way (re-fetched free on demand) — only the
address/score/permit record is stored server-side.

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

