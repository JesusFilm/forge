---
id: "feat-060"
title: "On-Demand Personalized Video Generation"
owner: "vlad"
priority: "P1"
status: "not-started"
start_date: "2026-09-01"
duration: 30
depends_on:
  - "feat-056"
  - "feat-057"
blocks: []
tags:
  - "generation"
  - "personalization"
  - "shared"
---

## Problem

This is shared work between Vlad and Tatai. Once templating and rendering exist, the next step is letting the platform generate a video on demand for a specific request, audience, or context instead of only shipping prebuilt outputs.

## Entry Points — Read These First

1. `docs/roadmap/media-generation/feat-056-ai-video-template-system.md` — reusable generation templates
2. `docs/roadmap/media-generation/feat-057-automated-video-rendering-engine.md` — render execution layer
3. `apps/manager/src/app/api/jobs/route.ts` — job submission pattern
4. `apps/manager/src/services/storage.ts` — generated artifact persistence
5. `apps/web/src/app/page.tsx` — likely public request-entry surface

## Grep These

- `jobs` in `apps/manager/src/app/api/`
- `artifact` in `apps/manager/src/services/`
- `template` in `docs/roadmap/media-generation/`
- `render` in `docs/roadmap/media-generation/`

## What To Build

1. Define the request contract for on-demand generation, including audience context and generation intent.
2. Connect request intake to template selection, render job creation, and artifact delivery.
3. Add safe limits for request size, frequency, and content boundaries so the system remains operable.
4. Keep the system compatible with future public-facing and partner-facing generation surfaces.

## Constraints

- Do NOT expose expensive render paths without quotas, gating, or queue controls.
- Prefer typed generation requests over free-form prompt dumping.
- Keep personalization explainable enough for debugging and review.

## Verification

- A request can create a personalized generation job end to end
- The generated artifact is persisted and retrievable after completion
- Queue controls and failure states are visible to operators
