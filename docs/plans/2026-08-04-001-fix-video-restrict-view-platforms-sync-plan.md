---
title: "fix: Sync and enforce Core's per-platform video view restriction"
type: fix
status: active
date: 2026-08-04
---

# fix: Sync and enforce Core's per-platform video view restriction

## Overview

Core (`api-media`, in the separate `JesusFilm/core` repo) lets publishers restrict
a Video from being viewed on specific consuming platforms
(`Video.restrictViewPlatforms: [watch | arclight | journeys]`). Forge's nightly
Core Sync never pulled that field in, and Forge's own `Video` model has nowhere
to store it, so every video that syncs is fully public in Forge regardless of
its Core-side restriction. This PR (1 of 2) adds the missing column and syncs
the field in; a follow-up PR enforces it across Forge's public surfaces.

## Problem Frame

Reported bug (Holly Gooden, High priority, no workaround): the vertical cut of
"Impulses for the Way" (`2_ElCamImpulsesVert`) is restricted from `watch` in
Core (`restrictViewPlatforms: ["arclight", "watch"]`, confirmed correct in
Core's videos-admin and its Algolia index) but still appears when searching on
production watch (`apps/web`, backed by this `apps/admin` service).

Root cause: `apps/admin/src/services/core-sync/phases/sync-videos.ts`'s
`VIDEOS_QUERY` never requests `restrictViewPlatforms` from Core, `CoreVideoSchema`
has no field for it, and the `Video` Prisma model has no column for it. The data
is simply never in Forge's database — this affects every Core-restricted video,
not just this one title.

## Requirements Trace

- R1. Add a `restrictViewPlatforms` column to Forge's `Video` model, synced
  read-only from Core (Core is the source of truth; `source = "MANAGER"` rows
  keep their existing "never overwritten by Core" semantics).
- R2. Thread the field through the Core Sync `videos` phase (query, schema
  validation, upsert) so it's populated on both create and update.
- R3. Surface the field somewhere in Forge's own GraphQL schema, read-only, so
  it's at least visible for debugging — this exact bug was hard to diagnose
  partly because nothing in Forge showed this state anywhere.
- R4. No behavior change for viewers in this PR — enforcement is a separate,
  following PR (see Deferred below) so this lands as a small, safely
  reviewable, additive-only change.

## Scope Boundaries

- Do not enforce the restriction anywhere yet (no query/resolver changes
  beyond exposing the raw field) — that's PR 2.
- Do not sync `restrictDownloadPlatforms` — a separate Core field, not part of
  the reported bug.
- Do not add any dashboard UI beyond the plain read-only GraphQL field.

### Deferred to Separate PR (already scoped, follow-up in this same session)

- **PR 2 — enforcement**: exclude restricted-for-`watch` videos from every
  public, web/mobile/tv-reachable surface: the Typesense search-index builder
  (`buildCatalogDocuments`), video-detail/home/browse resolvers in
  `video.service.ts`, the `videoParentsFilter`/`videoChildrenFilter` principal
  filters, and the raw-SQL CTEs in `getWatchLanguageInventory` and
  `scene-recommendations-retriever.ts`. Principal-aware throughout — editors/
  admins keep seeing restricted videos in Forge's own dashboard.
- Fixing several unrelated, pre-existing gaps found during investigation where
  some public resolvers (`getById`, `getBySlug`, `list`) don't filter
  DRAFT/unpublished status at all today — a different, unreported bug; flagged
  to the team as a separate follow-up rather than fixed opportunistically here.

## Context & Research

### Relevant code and patterns

- `apps/admin/src/services/core-sync/phases/sync-videos.ts` — the `videos`
  sync phase; `VIDEOS_QUERY` (Core GraphQL query), `CoreVideo` type, and the
  `tx.video.upsert(...)` call are all extended here.
- `apps/admin/src/services/core-sync/schemas/video.ts` — `CoreVideoSchema`,
  the Zod gate every Core payload passes through before use.
- `apps/admin/prisma/schema.prisma` (`Video` model) — existing `locked`/
  `noIndex` booleans are the closest precedent for a Core-synced flag; new
  migration follows the `String[] @default([]) ADD COLUMN ... TEXT[] DEFAULT
ARRAY[]::TEXT[]` convention used by `0034_enriched_transcript_chunks`.
- `apps/admin/src/graphql/types/video.ts` — `Video` Pothos type is explicitly
  documented as "Read-only at the GraphQL layer in v1"; the new field follows
  that convention (`t.exposeStringList`).
- Core's `Platform` GraphQL enum (`arclight | journeys | watch`, confirmed in
  `JesusFilm/core`'s `apis/api-media/schema.graphql`) serializes as lowercase
  strings — matches the raw Algolia record the reporter already checked
  (`["arclight", "watch"]`).

### Institutional learnings

None found specific to this field; `apps/admin/AGENTS.md`'s core-sync
conventions (source='MANAGER' short-circuit, flat Core queries) were followed
as-is.

## Key Technical Decisions

- Store the field as a plain `String[]` (not a new Postgres enum) — Forge has
  no other consumer of a "Platform" concept, and the only downstream use is a
  simple containment check (`'watch' = ANY(...)` / Prisma `{ has: "watch" }`).
- No special-casing needed for the `source === "MANAGER"` skip in the sync
  loop — the new field is added inside the same `create`/`update` blocks as
  every other Core-owned field, so it automatically inherits "Core never
  overwrites a Manager-owned row."
- Split into two PRs rather than one: this PR is purely additive (new column,
  populated but unread) so it's trivially safe to review/merge/deploy ahead of
  the enforcement PR, which is the one that actually changes what viewers see.

## Verification

- `pnpm --filter admin test` — full suite passes (280 files / 4181 tests),
  including updated fixtures in `sync-videos.test.ts` and
  `core-sync/schemas/video.test.ts`.
- `pnpm --filter admin lint` (eslint) — clean on all touched files.
- `pnpm --filter admin typecheck` (`tsc --noEmit`) — clean.
- Migration verified against a real Postgres instance (not just hand-inspected
  SQL): all 48 migrations applied in order via `psql`, ending in the new
  `ALTER TABLE`; confirmed the column round-trips
  (`INSERT ... restrict_view_platforms = ARRAY['watch','arclight']`) and that
  `'watch' = ANY(restrict_view_platforms)` — the exact predicate PR 2's raw-SQL
  enforcement will reuse — matches correctly.

## Sources / References

- Original bug report: Holly Gooden, Video Management, High priority.
- `JesusFilm/core` (`apis/api-media`) — `Video.restrictViewPlatforms`,
  `Platform` enum, `algoliaVideoUpdate` (the analogous Core-side enforcement
  this PR's follow-up mirrors for Forge's Typesense index).
