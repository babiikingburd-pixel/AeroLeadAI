# AeroLeadAI Property Intelligence Console

A Next.js 14 app for AI-powered property damage analysis (roof/tree/driveway scoring), lead mapping, and batch upload pipeline.

## How to run

```
npm run dev
```

Runs on port 5000. The workflow "Start application" is pre-configured.

## Required environment variables

At least one AI key is required:

- `GROQ_API_KEY` — free, no credit card (console.groq.com → API Keys)
- `ANTHROPIC_API_KEY` — pay-as-you-go Claude (better quality); takes precedence over Groq if both are set

## Optional environment variables

- `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY` — enables real magic-link auth and cross-device sync (falls back to password gate + localStorage if unset)
- `SUPABASE_SERVICE_ROLE_KEY` — lets manual permit entries write to shared Supabase directory
- `GOOGLE_MAPS_API_KEY` or `MAPBOX_TOKEN` / `NEXT_PUBLIC_MAPBOX_TOKEN` — enables autonomous satellite imagery fetch by address
- `PERMIT_API_KEY` + `PERMIT_API_PROVIDER` — permit history lookup (Shovels.ai or PermitStack)

## Stack

- Next.js 14 (App Router)
- React 18
- Supabase (optional — auth + storage)
- Groq / Anthropic Claude (AI vision and text)

## User preferences
