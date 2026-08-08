# AeroLeadAI APEX 10.1 — One-Launch Production Package

This is the complete cumulative AeroLeadAI application package prepared for production deployment.

## Recommended launch target

**Vercel + Supabase**

Vercel is the primary deployment target because this repository is a Next.js application and already contains `vercel.json` with the scheduled autonomous endpoints.

## Fastest path

### Option A — GitHub → Vercel (recommended)

1. Create a new GitHub repository.
2. Upload the **contents of this folder** to the repository root.
3. Open Vercel and choose **Add New Project → Import**.
4. Select the GitHub repository.
5. Leave Framework Preset as **Next.js** and leave the build/output settings at their defaults.
6. Add the environment variables listed in `.env.example`.
7. Deploy.

Vercel automatically detects Next.js. The included `vercel.json` registers the application's scheduled jobs.

### Option B — Direct Vercel CLI deployment

From the extracted project root:

```bash
npx vercel login
npx vercel --prod
```

Vercel will create/link the project and deploy the Next.js application.

For an unattended/CI deployment, authenticate the Vercel CLI first and then run:

```bash
npx vercel --prod --yes
```

## Production environment variables

At minimum for a serious production deployment:

- `ANTHROPIC_API_KEY` — production AI provider
- `NEXT_PUBLIC_SUPABASE_URL` — Supabase project URL
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` — Supabase public/anon key
- `SUPABASE_SERVICE_ROLE_KEY` — server-side Supabase operations where required
- `CRON_SECRET` — protects scheduled automation endpoints
- `NEXT_PUBLIC_MAPBOX_TOKEN` and/or `MAPBOX_TOKEN` — map/imagery features as applicable

Additional optional integrations are documented in `.env.example`.

**Never put service-role keys, Anthropic keys, or other private secrets in client-side code or commit them to GitHub.**

## Supabase initialization

The repository contains the SQL schemas/migrations required by the application's persistence and property-intelligence features.

Use the Supabase SQL Editor/migrations to apply the required schema before relying on production persistence.

The major root schemas include:

- `supabase_propintel_state_schema.sql`
- `supabase_batch_leads_schema.sql`
- `supabase_permits_schema.sql`
- `supabase_property_intelligence_schema.sql`
- `supabase_property_intelligence_permits_schema.sql`
- `supabase_autonomy_schema.sql`
- `supabase_ops_schema.sql`
- `supabase_lessons_schema.sql`
- `supabase_phase2_schema.sql`
- `supabase_agent_factory_schema.sql`

The `supabase/migrations/` directory also contains versioned migrations.

## What this package preserves

This package is cumulative. It retains the full application tree from the supplied APEX 10.0 build, including:

- Next.js web application
- API routes
- property intelligence modules
- APEX/Mission Control surfaces
- evidence and validation systems
- autonomous-cycle routes
- crawler and enrichment components
- Supabase schemas/migrations
- Windows scripts
- Android/Termux build helpers
- evidence index
- relay application
- verification/doctor/release scripts
- `vercel.json`

No feature was intentionally removed merely to make deployment smaller.

## Important honesty check

The supplied build's own merge notes report a successful prior verification state including:

- `npm install`
- `npm run doctor`
- `npm run verify`
- `npm run apex:status`
- `npx next build`

with the reported Next.js result of **102 app routes and 94 static pages**.

During preparation of this package, a fresh `npm ci` could not be completed in the current sandbox because the sandbox's package mirror returned HTTP 404 for `xlsx@0.18.5`. That is an environment/package-mirror limitation, not evidence that the source itself is broken. Do not treat the current sandbox as a successful fresh production build.

Before declaring the live deployment production-ready, Vercel must complete its own dependency install and `next build` successfully.

## First live smoke test

After deployment:

1. Open the Vercel production URL.
2. Confirm the main application loads.
3. Confirm `/api/system-health` responds.
4. Confirm `/api/apex-status` responds.
5. Confirm Supabase authentication/persistence if configured.
6. Confirm one real AI analysis using the configured provider.
7. Confirm Vercel Cron jobs appear under the project's Cron/Functions area.
8. Check function logs for errors before using the system for paid lead generation.

## Do not use the fallback password gate for a shared production system

For a private demo it can be useful. For the real SaaS deployment, configure Supabase Auth and production Supabase persistence.

