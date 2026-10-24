---
id: "feat-246"
title: "TV Home content parity — render rows from the single admin watch-home Experience"
owner: "urim"
priority: "P1"
status: "in-progress"
start_date: "2026-07-08"
duration: 4
depends_on:
  - "feat-179"
blocks: []
tags:
  - "tv"
  - "graphql"
---

## Problem

feat-179 shipped TV's focus-driven Home against a **code-curated** copy of the rows
plus a client-owned hero, and deliberately stopped reading the homepage Experience
(it was empty at the time). Since then web and mobile moved their Home body onto the
single admin `watch-home` Experience, leaving TV the only surface still hand-mirroring
the curation in code — feat-179's own requirements named this consolidation as the
deferred follow-up. This ticket points TV's rows at that same Experience so an editor
controls curation from one object, while TV's showcase, client-owned banner, and
precise series routing stay unchanged, with a fall back to code curation on absence.

## Entry Points — Read These First

1. `docs/plans/2026-07-08-003-feat-tv-home-experience-parity-plan.md` — the full plan (U1–U9, R1–R17, KTD1–10).
2. `docs/solutions/architecture-patterns/tv-home-single-admin-experience-migration-20260712.md` — the pattern + learnings.
3. `apps/tv/src/lib/watchHome/experienceAdapter.ts` — `buildWatchHomeSectionsFromExperience` (hydrate-by-coreId) + `reconcileWatchHome` (pure R8/R9/R10).
4. `apps/tv/src/hooks/useWatchHome.ts` — parallel fetch + chunked top-up + snapshot v2 wiring.
5. `apps/tv/src/lib/watchHome/model.ts` — `buildVideoByCoreIdIndex` (top-level + children, top-level-wins).
6. `apps/admin/src/graphql/types/blocks.ts` — the additive public `coreId` bridge on `MediaCollectionItem`.

## Grep These

- `coreId`, `watchHomeVideos`, `homepageExperience`, `reconcileWatchHome`, `buildVideoByCoreIdIndex`, `WATCH_HOME_HERO_SOURCE_IDS`.

## What To Build

- **Admin (U1–U2):** additive public `coreId` on the MediaCollection item, resolved via the batched `videoById` loader; add it to the shared `AdminMediaCollection` fragment (regenerate schema + introspection). _(shipped as #1507)_
- **TV (U3–U9):** public `GET_WATCH_SETTING` + two-layer guards; a coreId-keyed Experience→rails adapter that hydrates each item through the existing bulk fetch; a two-level hydration index; a chunked, bounded divergence top-up; a pure `reconcileWatchHome` state machine (Experience-vs-fallback + reason logging); snapshot v2; a hydrated, exercised, frozen code fallback; the hero stays client-owned. _(PR #1526)_

## Constraints

- Hydrate by `coreId`; do NOT render the flat Experience items (in prod `videoSlug` is null and `videoId` is the Video cuid, not hydratable).
- TV uses only public admin queries (`watchSetting`, `watchHomeVideos`); no bearer on the home path.
- Deploy admin (`coreId`) before any consumer emits `items { coreId }` (KTD9); verify the field is LIVE in prod, not just merged.
- The featured banner stays client-owned and image-based (no Mux inserts / playlist sequence — feat-179 scope); hero–web divergence is expected.

## Verification

- `pnpm --filter @forge/tv test` + `typecheck` green (626 tests as of 2026-07-12).
- Prod hydration gate: every `watch-home` item `coreId` covered by the config-pool index (42/42, 0 divergent).
- tvOS sim smoke: admin-authored rows render, exact meta chips, banner cycles, static mission tail.
- Web/mobile home queries still succeed after the shared-fragment `coreId` edit.
