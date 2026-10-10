---
id: "feat-109"
title: "Admin Core Sync Entity Coverage"
owner: "tataihono"
priority: "P0"
status: "complete"
start_date: "2026-04-28"
duration: 3
depends_on:
  - "feat-086"
  - "feat-093"
blocks:
  - "feat-104"
  - "feat-110"
tags:
  - "platform"
  - "admin"
  - "core-sync"
  - "data-model"
---

## Problem

The admin app has a Core sync spine, but the remaining migration question is
entity coverage: every Core-sourced entity and relationship that belongs in the
admin data model must be ingested directly from Core and kept fresh as Core
changes. This work should not preserve Strapi shapes for their own sake. It
should use the prior sync only as historical evidence of the Core coverage that
worked, then map Core facts into admin-native models. Locale handling must
follow the same mental model as Experiences: canonical parent rows for stable
identity and first-class per-locale rows for localized user-facing content.

## Entry Points - Read These First

1. `docs/brainstorms/2026-04-28-admin-core-sync-entity-coverage-requirements.md`
2. `apps/admin/AGENTS.md`
3. `apps/admin/CLAUDE.md`
4. `apps/admin/prisma/schema.prisma`
5. `apps/admin/src/services/core-sync/`
6. `docs/brainstorms/2026-03-19-cms-core-sync-requirements.md`
7. `docs/solutions/cms/core-sync-incremental-delta-sync.md`
8. `docs/solutions/cms/core-sync-per-page-upsert-pattern.md`

## Grep These

- `model VideoImage|model VideoSubtitle|model VideoEdition|model VideoOrigin|model BibleCitation|model VideoRelation|model VideoKeyword|model CountryLanguage|model MuxVideo` in `apps/admin/prisma/schema.prisma`
- `LANGUAGES_QUERY|COUNTRIES_QUERY|KEYWORDS_QUERY|VIDEOS_QUERY|DUBS_QUERY` in `apps/admin/src/services/core-sync/phases/`
- `updatedAt: { gte|deletedAt|source: "CORE"|source === "MANAGER"` in `apps/admin/src/services/core-sync/`
- `videoVariants|subtitles|images|bibleCitations|parents|children|origin|editions|downloads|mux` in `apps/cms/src/api/core-sync/`

## What To Build

1. Inventory every Core entity, nested object, and relationship previously
   needed for full video/reference coverage.
2. Classify each item as:
   - maps to an existing admin model,
   - requires a new admin-native model or field,
   - collapses into a derived/admin-native field,
   - deliberately drops from admin with rationale.
3. Audit localized Core fields against the `Experience` /
   `ExperienceLocale` pattern, preferring per-locale child rows for user-facing
   or retrieval-relevant content over opaque JSON blobs.
4. Extend admin Core sync to ingest every approved Core-sourced item.
5. Preserve freshness semantics: incremental updates reflect Core changes,
   full sync soft-deletes missing Core-sourced rows, and manager/admin-owned
   rows are not overwritten.
6. Add coverage verification that compares Core counts/relationships against
   admin rows after sync.

## Constraints

- Do not add Strapi dependencies or Strapi-shaped compatibility models.
- Do not hand-edit generated Prisma Client or generated GraphQL outputs.
- Keep Core-sourced entities read-only through admin GraphQL unless a separate
  editor workflow explicitly takes ownership.
- Preserve admin's `source='CORE'` / `source='MANAGER'` overwrite boundaries.

## Verification

- `pnpm --filter @forge/admin test`
- `pnpm --filter @forge/admin typecheck`
- A full Core sync produces zero missing approved entity classes.
- Localized Core content lands in per-locale admin rows where it affects public
  rendering, search, editorial review, or future embeddings.
- Incremental sync updates changed Core rows without requiring a full sync.
- Full sync soft-deletes Core-sourced rows no longer returned by Core.

## Completion Notes

- Added admin-native schema coverage in
  `apps/admin/prisma/migrations/0007_admin_core_sync_coverage/migration.sql`.
- Expanded Core sync queries, schemas, transforms, and phase writes for the
  approved reference, video, and dub entity classes.
- Verified the live Core API accepts the expanded language, country, video,
  video variant, and Bible book query shapes.
- Added `runCoverageAudit()` and exposed audit output through `systemStatus`
  and `runSync()` for post-sync review.
- Added first-class reference locale rows for languages, countries, and
  continents; parent JSON name maps remain compatibility mirrors only.
- Verified real Core/admin coverage on 2026-04-28: audit status `pass`,
  including 10,480 active subtitles keyed by Core subtitle id.
- Documented the final mapping and locale rules in
  `docs/solutions/platform/admin-core-sync-entity-coverage.md`.
