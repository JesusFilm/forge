---
id: "feat-371"
title: "Recommendation subtitle and audio signals"
owner: "nisal"
priority: "P1"
status: "not-started"
start_date: ""
duration: 3
depends_on:
  - "feat-369"
blocks: []
tags:
  - "admin"
  - "web"
  - "watch"
  - "recommendations"
  - "subtitles"
  - "audio"
---

## Problem

Language and accessibility interactions are useful context, but they must not be mislabeled as satisfaction.

## Entry Points — Read These First

1. `docs/plans/2026-08-18-2219-feat-watch-recommendation-learning-system-plan.md` — canonical architecture and U4 contract.
2. `apps/web/src/components/watch/`
3. `apps/admin/src/services/recommendations/`
4. `apps/admin/src/app/dashboard/recommendations/`

## Grep These

- `subtitle|caption|textTrack`
- `audioLanguage|languageSlug`
- `recommendation.*signal`

## What To Build

- Capture track availability, explicit subtitle enable/disable, audio-language changes, timing, active locale, and missing/unsupported states.
- Derive coverage and context projections separately from playback-quality outcomes.
- Add a readiness decision for each derived language/accessibility signal without permitting live ranking use.

## Admin Evidence Gate

- Show availability, interaction timing, locale coverage, missingness, and readiness decisions without calling the interactions satisfaction.
- Allow operators to compare behavior by locale and playback outcome while respecting cohort suppression.

The ticket is not complete until this result is visible and reconcilable in the authorized Admin Recommendations area.

## Constraints

- Do not infer preference when a track was unavailable or enabled by default.
- Keep accessibility controls keyboard- and screen-reader-usable.
- No language signal affects live ranking until a later shadow and promotion decision.
- Declare purpose, identity class, retention, access, deletion behavior, ingestion health, and rollback/fallback for every new recommendation record.
- Preserve player startup and Watch availability when recommendation telemetry or Admin is degraded.

## Verification

- Test default versus explicit subtitles, audio switches, unavailable preferred tracks, repeated events, locale fallback, keyboard use, and screen-reader announcements.
- Test projection replay, retention, deletion, and cohort suppression.
- Reconcile sampled episodes in Admin.
- Run affected application checks: `pnpm --filter @forge/web test`, `pnpm --filter @forge/web lint`, and `pnpm --filter @forge/web typecheck`; `pnpm --filter @forge/admin test`, `pnpm --filter @forge/admin lint`, and `pnpm --filter @forge/admin typecheck`.
- Run `pnpm --filter roadmap lint` after updating roadmap metadata.
