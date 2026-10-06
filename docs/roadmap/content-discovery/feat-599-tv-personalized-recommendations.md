---
id: "feat-599"
title: "Anonymous personalized recommendations for Apple TV and Android TV"
owner: "ekkasit"
priority: "P1"
status: "in-progress"
start_date: "2026-10-02"
duration: 7
depends_on: []
blocks: []
tags: [tv, graphql, recommendations]
---

## Problem

TV still uses a seeded Because you watched rail instead of the shared anonymous
recommendation service. Playback must contribute actual foreground watch facts.

## Entry Points — Read These First

1. `docs/operations/user-recommendations.md`: canonical native API lifecycle.
2. `apps/tv/app/index.tsx`: Home ordering and focus-safe rail rendering.
3. `apps/tv/app/_layout.tsx`: all player variants and playback ownership.
4. `packages/admin-graphql/src/operations/recommendations.ts`: typed mutations.

## Grep These

`Because you watched|onPlaybackPosition|timeControlStatus|isPlaying`

## What To Build

Follow `docs/plans/2026-10-02-tv-personalized-recommendations.md`.
Add installation identity, six-card delivery, attribution, actual playback facts,
and personalization controls. Retain the legacy rail behind the TV feature flag.

## Constraints

No account requirement, schema migration, pool expansion, capability URLs/logs,
or changes to `apps/tv-feedback`. Use simulators/emulators, not physical Apple TV.

## Verification

Run TV Jest, typecheck, lint, native build checks and device journeys for every
player. Verify accepted backend facts. Upload beta binaries from one commit to
TestFlight (`appletvos`) and Google Play Internal Testing, not production.
