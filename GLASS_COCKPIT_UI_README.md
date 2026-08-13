# AeroLeadAI Glass Cockpit UI

A polished glass/desktop command interface layered over the existing AeroLeadAI map.

## What it adds
- Full-screen translucent map stage.
- Frosted-glass command panels with blur/saturation.
- Drag-anywhere floating panels.
- Animated radar, scan line, telemetry, and cockpit status indicators.
- Direct navigation rail for core AeroLeadAI modules.
- Apex Roofing #1 contractor-priority panel.
- Live Top-10 opportunity feed from `/api/opportunities/top10`.
- Responsive layout for desktop and smaller screens.

## Route

Open `/cockpit` after starting the Next.js application.

The cockpit is an interface layer, not a replacement for the existing scoring/evidence engines. Property rankings remain evidence-based and the Apex Roofing priority is a contractor-routing priority.

## Map

The existing `LeadMap` is used underneath the interface. For the richest visual result, configure `NEXT_PUBLIC_MAPBOX_TOKEN` as the existing map component expects.

## Design direction

The visual language is intentionally inspired by premium glass desktop interfaces and futuristic spacecraft instrumentation without copying any proprietary Apple UI assets.
