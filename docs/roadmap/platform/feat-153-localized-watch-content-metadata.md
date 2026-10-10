---
id: feat-153
title: Localized watch content metadata from Core
status: "complete"
priority: high
area: platform
tags:
  - admin
  - web
  - watch-page
  - core-sync
  - i18n
depends_on: []
blocks:
  - feat-154
---

## Problem

The new watch app now localizes Russian UI chrome, but video content data such
as title, description, sibling titles, and study questions still renders in
English. The legacy `www.jesusfilm.org/watch` page fetched localized Core video
metadata by Core language id at request/build time; the Forge watch app reads
admin `VideoLocale` and `VideoStudyQuestion` rows.

Follow-up verification found two separate gaps. First, admin sync has only
English rows for the reported Russian route and likely lacks other non-English
Core localized metadata as well. A Core probe showed `title(primary: false)`
and `studyQuestions(primary: false)` enumerate many localized values for the
same video, so admin must import every localized metadata value Core returns,
not only `ru`. Second, web currently passes the public audio slug (`russian`)
into `Video.locales(locale:)`; web must query rows with the stable content
language identity while keeping `russian` for dub selection.

## Plans

- Admin/Core data plane:
  `docs/plans/2026-06-01-001-feat-core-i18n-video-metadata-sync-plan.md`
- Web rendering plane:
  `docs/plans/2026-06-01-002-feat-watch-language-rendering-plan.md`

## Entry Points

- `apps/admin/src/services/core-sync/phases/sync-videos.ts`
- `apps/admin/src/services/core-sync/transforms.ts`
- `apps/admin/src/graphql/types/video.ts`
- `apps/admin/prisma/schema.prisma`
- `apps/web/src/lib/fragments/watch-video.ts`
- `apps/web/src/lib/content.ts`
- `apps/web/src/lib/locale.ts`

## What To Build

Track A, Admin/Core sync: import localized Core video metadata into admin for
every localized metadata language Core returns for synced videos, expose
locale-narrowed study questions, and provide a repeatable backfill entrypoint.
The normal videos sync must reuse the same localized-overlay helper going
forward so new Core changes keep non-English rows fresh.

Track B, Web language rendering: make the watch resolver read localized titles,
descriptions, sibling titles, and study questions from admin using the resolved
content BCP-47 locale, while keeping the public audio slug for dub selection and
falling back to English when localized content rows are absent.

## Constraints

- Web continues to read through admin GraphQL only; do not add a direct Core
  API fallback inside `apps/web`.
- Preserve public audio language slug routing and UI catalog fallback as
  separate concerns.
- Do not attempt a blind 2,000+ language metadata fan-out. Use Core's returned
  localized metadata enumeration for each processed video and import every
  returned value; playable languages with no localized metadata do not need
  empty rows.
- Preserve Core/source ownership boundaries: Core-sourced rows stay read-only
  through admin GraphQL.
- Do not use manual SQL inserts for the production repair; the backfill must use
  the same Core-fetch/write path as the forward sync.
- Sequence admin schema/sync/backfill before production web smoke that expects
  localized catalog content.

## Verification

- Admin sync tests prove localized `VideoLocale` and `VideoStudyQuestion` rows
  are created and updated for multiple Core-returned languages, including but
  not limited to English and Russian.
- Admin GraphQL tests prove `studyQuestions(locale:)` returns only the
  requested locale and omits soft-deleted rows.
- Admin GraphQL smoke proves `videoBySlug(...).locales(locale: "ru")` and
  `studyQuestions(locale: "ru")` return Russian rows for the reported video
  after backfill.
- Admin GraphQL smoke also proves the reference video has multiple non-English
  localized rows after backfill, demonstrating this is not a Russian-only fix.
- Web content tests prove `/watch/parable-of-the-pharisee-and-tax-collector.html/russian.html`
  queries admin content with `ru`, keeps `russian` for dub selection, selects
  Russian catalog metadata when admin has it, and falls back to English when
  admin does not.
- Browser smoke proves visible app-owned UI remains Russian and catalog content
  strings for the reported route are Russian after sync/backfill.
