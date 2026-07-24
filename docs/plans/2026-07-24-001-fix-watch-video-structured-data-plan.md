---
title: "fix: Watch video structured data Search Console issues"
type: fix
status: active
date: 2026-07-24
---

# fix: Watch video structured data Search Console issues

## Overview

Fix Watch page `VideoObject` JSON-LD so sparse-but-playable records can provide
complete `uploadDate` and `description` metadata when the values can be derived
honestly from existing Admin GraphQL data. The change adds one Admin GraphQL
snapshot scalar for localized publish date, then carries that value through
`apps/web` while preserving the current guardrail that suppresses `VideoObject`
markup when a record lacks an eligible real media URL instead of publishing
misleading `contentUrl` or `embedUrl` values.

## Problem Frame

Google Search Console reported video structured data issues for jesusfilm.org:
missing `uploadDate`, missing `description`, and missing `contentUrl` or
`embedUrl`. The Watch page already emits `VideoObject` JSON-LD for playable
videos, but records with sparse localized copy or missing video-level publish
dates can leave Google with incomplete metadata. The `contentUrl` / `embedUrl`
warning cannot be honestly fixed without knowing whether Search Console's sample
URLs have real media/player URLs available, so this plan preserves strict media
URL suppression and tracks the production sample audit separately. Google
documents `name`, `thumbnailUrl`, and `uploadDate` as required `VideoObject`
properties, and recommends `description`, `duration`, and either `contentUrl` or
`embedUrl`.

## Requirements Trace

- R1. Watch video `VideoObject` JSON-LD must have a non-empty description when
  a truthful fallback can be derived from the resolved video title.
- R2. Watch video `VideoObject` JSON-LD must use video-level `publishedAt` when
  available and fall back to localized publish date when the video-level value
  is absent. For Core-synced rows, Admin copies the same Core video publish
  timestamp into `VideoLocale.publishedAt`, making it an acceptable localized
  availability fallback rather than an unrelated translation publish date.
- R3. Watch video `contentUrl` must remain restricted to stable HTTPS media
  URLs; do not substitute the public Watch page URL as `contentUrl` or
  `embedUrl`.
- R4. Noindex or genuinely incomplete media records must still suppress
  `VideoObject` JSON-LD.
- R5. The change must be covered at helper and rendered Watch page levels.
- R6. Media URL sample investigation must be tracked separately because the
  Search Console email does not include affected URLs and the current change
  deliberately avoids fake `contentUrl` / `embedUrl` values.

## Scope Boundaries

- Do not change database models or unrelated Admin schema fields.
- Regenerate Admin GraphQL artifacts for the additive `publishedAt` snapshot
  locale field.
- Do not emit `embedUrl` unless a real player URL is available.
- Do not broaden public page/social metadata fallbacks beyond the
  structured-data-specific behavior.
- Do not claim the `contentUrl` / `embedUrl` production warning is fully
  resolved until Search Console sample URLs are inspected.
- Do not deploy directly to production from this worktree.

## Context & Research

### Relevant Code and Patterns

- `apps/web/src/lib/experience-metadata.ts` builds the Watch metadata model
  consumed by page metadata and structured data.
- `apps/web/src/lib/watch-structured-data.ts` serializes JSON-LD and already
  validates HTTPS media URLs, thumbnails, duration, noindex, and upload date.
- `apps/web/src/lib/fragments/watch-video.ts` owns the Admin GraphQL Watch video
  selections.
- `apps/web/src/lib/content.ts` normalizes Admin video and locale rows into
  `WatchVideoRecord`.
- `apps/admin/src/services/video.service.ts` builds Watch route snapshot locale
  DTOs from Prisma rows.
- `apps/admin/src/graphql/types/video.ts` exposes Watch route snapshot locale
  fields through Pothos.
- `apps/web/src/app/[locale]/[htmlLang]/[...rest]/__tests__/page-routing.test.tsx`
  verifies rendered server JSON-LD.
- `apps/web/AGENTS.md` requires App Router patterns, server-only Admin
  GraphQL access, and no page-head Watch hreflang.

### Institutional Learnings

- `docs/solutions/performance-issues/watch-hero-poster-idle-autoplay-20260610.md`
  notes Watch pages already rely on SSR metadata, canonical URLs, and JSON-LD;
  preserve those SEO-critical server-rendered surfaces.
- `docs/solutions/integration-issues/admin-image-lqip-dominant-color-pipelines-20260709.md`
  reinforces that metadata should be derived from actual source data, not
  placeholders that look valid but misrepresent content.

### External References

- Google Search Central, Video structured data:
  `https://developers.google.com/search/docs/appearance/structured-data/video`

## Key Technical Decisions

- Add a `structuredDataDescription` field separate from page metadata
  description so JSON-LD can have a conservative fallback without changing Open
  Graph, Twitter, or visible page copy.
- Expose `publishedAt` on Admin `WatchRouteSnapshotLocale`, then select
  `VideoLocale.publishedAt` in Watch locale GraphQL selections and carry it
  through `WatchVideoRecord` as `localePublishedAt`; Admin Core sync derives
  both video and locale publish dates from the same Core video `publishedAt`
  source for Core-managed rows.
- Keep `contentUrl` validation unchanged: only stable HTTPS `.m3u8` URLs with no
  credentials, query, or hash are eligible.
- Create a follow-up roadmap item for Search Console sample URL inspection and
  any real media/player URL work needed after production data is known.

## Open Questions

### Resolved During Planning

- Should `embedUrl` be added as a fallback? No. The current code has no
  dedicated player URL contract, and Google says `embedUrl` should point to the
  player itself, not the Watch page.
- Should the slug be used as a structured-data title? No. Existing tests
  intentionally avoid slug fallback for `VideoObject.name`; preserve that
  quality guardrail.

### Deferred to Implementation

- Which production URLs were reported by Search Console: validate through Search
  Console or URL Inspection after deploy, because the email did not include the
  affected sample URLs.
- Whether reported URLs lacking eligible `.m3u8` media have a real player URL
  contract suitable for `embedUrl`: depends on production samples and is tracked
  as follow-up work.

## Implementation Units

- [x] **Unit 1: Carry localized publish date into Watch metadata**

**Goal:** Make localized publish date available to the Watch metadata model.

**Requirements:** R2

**Dependencies:** None

**Files:**

- Modify: `apps/admin/src/services/video.service.ts`
- Modify: `apps/admin/src/graphql/types/video.ts`
- Generate: `apps/admin/schema.graphql`
- Generate: `packages/admin-graphql/src/admin-graphql-env.d.ts`
- Modify: `apps/web/src/lib/fragments/watch-video.ts`
- Modify: `apps/web/src/lib/content.ts`
- Test: `apps/web/src/lib/content.test.ts`
- Test: `apps/web/src/lib/experience-metadata.test.ts`

**Approach:**

- Add `publishedAt` to the Admin Watch route snapshot locale DTO and Pothos
  object.
- Add `publishedAt` to Watch localized-copy selections for exact, broad, and
  English fallback locale rows.
- Normalize the selected locale row into a `localePublishedAt` field
  on `WatchVideoRecord`.
- Build `uploadDate` from `video.publishedAt` first, then
  `video.localePublishedAt`, using the first valid date.

**Patterns to follow:**

- Existing locale row normalization in `normalizeAdminVideo`.
- Existing metadata model tests in `apps/web/src/lib/experience-metadata.test.ts`.

**Test scenarios:**

- Happy path: video with video-level `publishedAt` keeps that date as
  `uploadDate`.
- Edge case: video with `publishedAt: null` and a localized publish date uses
  the localized date.
- Edge case: invalid video-level `publishedAt` falls back to a valid localized
  publish date.
- Normalization: route snapshot locale `publishedAt` is preserved as
  `localePublishedAt`.
- Edge case: Core-synced localized publish date is treated as an availability
  fallback because Admin Core sync derives it from Core video `publishedAt`.

**Verification:**

- Metadata model tests prove the fallback date reaches `uploadDate`.

- [x] **Unit 2: Add structured-data-only description fallback**

**Goal:** Prevent missing `description` warnings for titled playable videos
without changing page or social metadata behavior.

**Requirements:** R1, R4

**Dependencies:** Unit 1

**Files:**

- Modify: `apps/web/src/lib/experience-metadata.ts`
- Modify: `apps/web/src/lib/watch-structured-data.ts`
- Test: `apps/web/src/lib/experience-metadata.test.ts`
- Test: `apps/web/src/lib/watch-structured-data.test.ts`

**Approach:**

- Add `structuredDataDescription` to the metadata model.
- Prefer authored description, then snippet, then a short title-derived
  Jesus Film Project fallback when `structuredDataTitle` exists.
- Have JSON-LD serialization read `structuredDataDescription` before the page
  description and suppress `VideoObject` when that structured-data field is
  unavailable.

**Patterns to follow:**

- Existing `structuredDataTitle` separation from page title in
  `apps/web/src/lib/experience-metadata.ts`.
- Existing incomplete `VideoObject` suppression tests in
  `apps/web/src/lib/watch-structured-data.test.ts`.

**Test scenarios:**

- Happy path: authored description remains serialized as JSON-LD description.
- Edge case: missing description and snippet with a valid video title produces a
  title-derived structured-data description while page metadata description
  remains empty.
- Edge case: fallback includes the resolved video title so titled videos do not
  collapse into one identical boilerplate description.
- Error path: missing title and missing structured-data description still
  suppresses `VideoObject`.

**Verification:**

- Helper tests cover fallback and suppression behavior.

- [x] **Unit 3: Verify rendered Watch JSON-LD contract**

**Goal:** Ensure route-level server output still includes complete JSON-LD for
playable videos and suppresses JSON-LD for noindex records.

**Requirements:** R3, R4, R5

**Dependencies:** Unit 2

**Files:**

- Test: `apps/web/src/app/[locale]/[htmlLang]/[...rest]/__tests__/page-routing.test.tsx`

**Approach:**

- Reuse existing rendered Watch route tests that parse JSON-LD scripts from
  server HTML.
- Confirm `contentUrl` remains actual media and `embedUrl` is not emitted.

**Patterns to follow:**

- Existing `jsonLdByType("VideoObject")` assertions in the catch-all route
  tests.

**Test scenarios:**

- Integration: playable Watch video renders a single `VideoObject` with
  `description`, `uploadDate`, `contentUrl`, thumbnail, duration, and publisher.
- Integration: sparse playable Watch video with localized publish date and no
  authored copy renders title-derived `description` and valid `uploadDate`.
- Integration: noindex video emits no JSON-LD.

**Verification:**

- Route-level Watch test suite passes.

## System-Wide Impact

- **Interaction graph:** Admin service DTOs feed Admin GraphQL schema, whose
  selections feed `content.ts`
  normalization, which feeds `experience-metadata.ts`, which feeds
  `watch-structured-data.ts`, which renders in Watch page server components.
- **Error propagation:** Invalid or missing dates still fail closed at JSON-LD
  serialization by returning `null`.
- **State lifecycle risks:** No database writes, cache mutations, migrations, or
  partial state risks.
- **API surface parity:** Web-only metadata model changes; mobile and TV
  consumers are unchanged.
- **Integration coverage:** Route-level server-rendered JSON-LD test covers the
  cross-layer path.
- **Unchanged invariants:** Noindex suppression, stable media URL validation,
  and absence of page-head Watch hreflang stay intact.

## Risks & Dependencies

| Risk                                                                          | Mitigation                                                                                                                                                                     |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Title-derived fallback could create duplicate descriptions across videos.     | Only use it for titled videos lacking authored copy; it includes the resolved title.                                                                                           |
| Adding locale `publishedAt` could widen GraphQL payloads.                     | One scalar on already-selected locale rows; no new relation fan-out. Regenerate Admin schema and web client artifacts.                                                         |
| Localized publish date could be mistaken for a translation publish timestamp. | Admin Core sync derives `VideoLocale.publishedAt` from Core video `publishedAt` for Core-managed rows; Manager-managed semantics should be validated before any broader reuse. |
| Google may still report specific records with missing media URLs.             | Preserve suppression for records without stable media; track Search Console sample inspection as follow-up work.                                                               |

## Documentation / Operational Notes

- Add or update a roadmap ticket for the metadata fallback issue and mark it
  complete when verified.
- Create a follow-up roadmap ticket for the `contentUrl` / `embedUrl` sample URL
  audit and any real media/player URL work it reveals.
- After deployment, use Search Console URL Inspection / validation on affected
  Watch URLs and allow time for recrawl.

## Sources & References

- Related code: `apps/web/src/lib/experience-metadata.ts`
- Related code: `apps/web/src/lib/watch-structured-data.ts`
- Related code: `apps/web/src/lib/fragments/watch-video.ts`
- Related code: `apps/web/src/lib/content.ts`
- Related tests: `apps/web/src/lib/experience-metadata.test.ts`
- Related tests: `apps/web/src/lib/watch-structured-data.test.ts`
- Related tests: `apps/web/src/app/[locale]/[htmlLang]/[...rest]/__tests__/page-routing.test.tsx`
- External docs: `https://developers.google.com/search/docs/appearance/structured-data/video`
