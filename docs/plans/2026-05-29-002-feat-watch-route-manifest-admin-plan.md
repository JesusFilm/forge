---
title: Admin-owned watch route manifest for bounded web route admission
type: feat
status: planned
date: 2026-05-29
origin:
  - docs/plans/2026-05-29-001-perf-restore-watch-static-render-locale-rewrite-plan.md
---

# Admin-owned watch route manifest for bounded web route admission

## Overview

The static `/watch` route rewrite plan needs a route-admission source that can
reject hostile-looking but invalid watch paths before App Router rendering,
admin GraphQL resolution, or ISR cache entry creation. The data that decides
whether a watch URL is valid lives in `apps/admin`: Core sync owns videos,
video locales, video relations, languages, and dubs; admin editing owns
Experience publish/update/archive state.

This plan adds an admin-owned **watch route manifest**: a compact, generated
contract that lists valid content slugs and parent/child route pairs without
enumerating every language-specific public URL. `apps/web` can consume the
manifest to answer "could this path ever be valid?" cheaply, while admin keeps
the manifest current after import, sync, add, delete, publish, and archive
flows.

This branch is intentionally stacked on
`perf/watch-static-locale-rewrite`. The web branch should consume the manifest
after this contract lands, then merge the admin-manifest branch back.

## Problem Statement

The current web plan bounds the internal `[locale]` segment, but `params.rest`
is still attacker-controlled. A random URL like
`/watch/anything.html/english.html` can be syntactically safe, pass language
validation, and reach the force-static catch-all. From there, the render path
can issue admin lookups before returning a 404. With ISR enabled, repeated
random paths can create compute work today and may create a storage-spray
surface once the static route cache is active.

The validity check cannot be based on hardcoded web route knowledge alone:

- `Video`, `VideoLocale`, `VideoRelation`, `VideoDub`, and `Language` are
  sourced through admin/Core sync.
- `Experience` and `ExperienceLocale` can be published, updated, or archived
  from admin.
- Admin local/import/sync/delete flows can change the valid public watch
  surface without a web code change.

The manifest must scale with content growth. The local branch test snapshot has
roughly 1k videos and more than 200k dubs, and admin already documents a single
Jesus-film-style collection fanout of about 61 children x 2,200 dubs. A route
manifest that enumerates `content x language` or `episode x language` will
grow in the wrong dimension.

## Goals

- Give admin one service that computes the public watch route-admission
  manifest from canonical admin data.
- Keep manifest size proportional to slugs, episode relations, and language
  slugs, not full public route permutations.
- Refresh the manifest after Experience publish/update/archive and after Core
  sync phases that can change route admission.
- Expose a stable contract that `apps/web` can consume in proxy or pre-render
  guards without querying admin per hostile request.
- Include tests for deletes, soft deletes, draft/unpublished rows, playable dub
  changes, and large fanout.

## Non-goals

- Do not implement the `apps/web` proxy consumer in this branch.
- Do not change public `/watch` URL shape.
- Do not enumerate every localized public route.
- Do not move audio-language aliasing, UI-message locale resolution, or
  `<html lang>` logic into admin.
- Do not make admin publish UX depend on a synchronous web/cache refresh.

## Existing Patterns

- `apps/admin/prisma/schema.prisma` models the relevant data:
  - `Language.slug`, `Language.bcp47`, and `Language.deletedAt`.
  - `Video.slug`, `Video.deletedAt`, `Video.noIndex`, `Video.locales`,
    `Video.dubs`, and `Video.children` / `Video.parents`.
  - `VideoLocale.status` and `(videoId, locale)`.
  - `VideoRelation.parentId` / `childId`.
  - `VideoDub.published`, `VideoDub.hls`, `VideoDub.languageId`, and
    `VideoDub.deletedAt`.
  - `Experience.archivedAt` and `ExperienceLocale.status`, `slug`,
    `isHomepage`, `pathSegment`.
- `apps/admin/src/services/revalidate-webhook.ts` is the precedent for
  best-effort web notification. It never blocks publish UX and silently no-ops
  when env is absent.
- `apps/admin/src/services/experience.service.ts` already calls
  `emitRevalidateWebhook` after published Experience locale updates,
  publishing, homepage changes, and archive.
- `apps/admin/src/services/core-sync/orchestrator.ts` runs Core sync phases in
  a known order and is the natural point to request a manifest refresh after
  route-relevant phases complete.
- `apps/admin/src/graphql/types/video.ts` exposes `childDubLanguages` as a
  bounded distinct language set, explicitly avoiding the large
  children-by-dubs fanout. The manifest should copy that scaling philosophy.
- `apps/web/src/lib/content.ts` currently treats unknown watch video and
  series misses as uncached success-path exceptions; this is correct for
  freshness but expensive for random path spray unless the path is rejected
  earlier.

## Manifest Contract

The admin service should produce a compact JSON shape:

```ts
type WatchRouteManifest = {
  version: string
  generatedAt: string
  contentSlugs: string[]
  oneSegmentSlugs: string[]
  episodePairsByParent: Record<string, string[]>
  audioLanguageSlugs: string[]
}
```

Field semantics:

- `version`: stable hash of the manifest content or a monotonically changing
  version token. Web uses it for cache replacement and logging.
- `generatedAt`: ISO timestamp for observability.
- `contentSlugs`: valid first-segment `.html` slugs for two-segment watch
  paths. Include public videos/series/collections and published Experience
  slugs that can be addressed by `/watch/{slug}.html/{audio}.html`.
- `oneSegmentSlugs`: valid one-segment collection/experience slugs such as
  `/watch/easter.html`. This must preserve the current web disambiguation:
  one-segment language slugs are localized-home, non-language slugs are
  collection/experience candidates.
- `episodePairsByParent`: parent slug to child slug list for three-segment
  routes such as
  `/watch/book-of-acts.html/the-holy-spirit-comes-at-pentecost/english.html`.
  This is the only parent/child relation the web proxy needs to admit episode
  shapes.
- `audioLanguageSlugs`: public audio-language slugs with at least one playable
  dub somewhere. Web may already have language metadata; include this only if
  it avoids a second source for "is this audio slug public and playable?"

The manifest deliberately does **not** include:

- `{contentSlug, audioLanguageSlug}` pairs.
- `{parentSlug, childSlug, audioLanguageSlug}` triples.
- localized titles, block content, images, HLS URLs, subtitles, or search data.
- admin IDs unless needed for debugging in a separate internal-only endpoint.

## Data Rules

### Videos

Include a video slug in `contentSlugs` when:

- `video.deletedAt IS NULL`.
- `video.slug` is non-empty.
- It has at least one `VideoLocale.status = PUBLISHED`.
- It is either directly playable or is a collection/series that web can render
  through its current series/collection paths.

For directly playable video admission, require at least one dub where:

- `video_dub.deletedAt IS NULL`.
- `video_dub.published = true`.
- `video_dub.hls IS NOT NULL`.
- `video_dub.languageId` points at a non-deleted `Language`.
- `language.slug IS NOT NULL`.

For series/collection admission, preserve existing web behavior: a parent can
be routable even when playback lives on its children rather than on the parent
itself. The implementation should document whether a parent needs a playable
trailer, at least one routable child, or either. Prefer matching current web
render semantics over inventing a stricter SEO rule.

### Episode pairs

Include `parentSlug -> childSlug` when:

- Parent and child videos are not soft-deleted.
- Both have non-empty slugs.
- Public users can see the child relation under existing GraphQL visibility
  rules.
- The child has at least one playable dub.
- The parent has enough public state to render a series/collection page.

Do not multiply pairs by audio language. The language slug is validated
separately.

### Experiences

Include Experience slugs when:

- `experience.archivedAt IS NULL`.
- `experience_locale.status = PUBLISHED`.
- `experience_locale.slug` is non-empty.
- The slug/path shape maps to a public watch route in current web semantics.

Homepage rows (`isHomepage = true`) should not create a content slug unless
their slug is independently routable today. `pathSegment` must be handled
deliberately: if watch currently ignores multi-segment Experience path segments,
the manifest should not introduce them.

### Languages

Include an audio language slug when:

- `language.deletedAt IS NULL`.
- `language.slug IS NOT NULL`.
- At least one playable dub uses that language.

This is a public audio slug set, not a UI message-catalog locale set. It must
not collapse `spanish-latin-american` into `es`.

## Implementation Units

### Unit 1 - Manifest service and SQL

Create `apps/admin/src/services/watch-route-manifest.service.ts`.

Responsibilities:

- Compute the manifest from Prisma/Postgres.
- Keep the query shape bounded and observable.
- Prefer raw SQL for the aggregate sets if Prisma would over-fetch relation
  trees.
- Return sorted arrays for deterministic hashes and snapshots.
- Log row counts and generation duration without logging full payloads.

Tests:

- `apps/admin/src/services/watch-route-manifest.service.test.ts`
- Covers playable video inclusion/exclusion, draft locales, soft-deleted
  videos/languages/dubs, parent/child pairs, one-segment Experience slugs, and
  deterministic ordering.
- Includes a fanout fixture with many dubs across multiple children and asserts
  output size grows by language set plus episode pairs, not route permutations.

### Unit 2 - Manifest persistence and versioning

Add a small persisted store for the latest manifest.

Preferred implementation:

- Add a Prisma model such as `WatchRouteManifestSnapshot` with a singleton key,
  `version`, `generatedAt`, `payload`, `payloadSizeBytes`, and `createdAt` /
  `updatedAt`.
- Add the corresponding migration under `apps/admin/prisma/migrations/`.
- Store JSONB so admin can serve the current manifest without recomputing on
  every request.

Alternative if avoiding a migration in this slice:

- Generate on demand behind a cached service boundary, then add persistence in
  a follow-up before production traffic uses it. This is weaker and should only
  be chosen if the migration risk is unacceptable for the stacked PR.

Tests:

- `apps/admin/src/services/watch-route-manifest-store.test.ts`
- Verifies upsert, version replacement, stale-read behavior, and payload size
  logging.

### Unit 3 - Admin refresh hooks

Wire manifest refresh requests from route-relevant admin lifecycle events.

Files:

- `apps/admin/src/services/experience.service.ts`
- `apps/admin/src/services/core-sync/orchestrator.ts`
- `apps/admin/src/services/core-sync/job.ts`
- `apps/admin/src/workflows/coreSync.ts`

Behavior:

- After Experience publish/update/archive events that already emit web
  revalidation, enqueue or fire-and-forget a manifest refresh.
- After Core sync completes phases that can change the manifest
  (`languages`, `videos`, `video-dubs`, and possibly relation-bearing video
  sync), refresh once per sync run, not once per row.
- If only unrelated phases run, skip the refresh.
- If refresh fails, log structured failure and do not fail the admin publish or
  sync job.

Tests:

- Extend `apps/admin/src/services/experience.service.test.ts` if present, or
  add focused tests around the service method that emits refresh.
- Extend `apps/admin/src/services/core-sync/orchestrator.test.ts` or
  `apps/admin/src/services/core-sync/job.test.ts` to assert one refresh after
  route-relevant phases and none after unrelated phases.

### Unit 4 - Manifest read endpoint

Expose the latest manifest to web.

Preferred endpoint:

- `apps/admin/src/app/api/watch-route-manifest/route.ts`

Contract:

- `GET` returns the latest manifest JSON plus `ETag` and
  `Cache-Control: private, max-age=0, must-revalidate` or another explicitly
  chosen service-to-service cache policy.
- Auth uses an existing service-token/bearer pattern. Do not expose the
  manifest anonymously unless the security review explicitly accepts it.
- If no manifest exists, generate once or return a clear 503 with instructions
  to run the refresh job. Prefer generation in controlled admin environments
  and 503 in production if on-demand generation would be too expensive.

Tests:

- `apps/admin/src/app/api/watch-route-manifest/route.test.ts`
- Covers auth, ETag/304 behavior if implemented, missing snapshot, and payload
  shape.

### Unit 5 - Web revalidation payload extension

Extend the existing admin-to-web notification contract so web knows when the
manifest changed.

Files:

- `apps/admin/src/services/revalidate-webhook.ts`
- `apps/admin/src/services/revalidate-webhook.test.ts`

Options:

1. Add `model: "watch-route-manifest"` to the existing webhook union and send
   it after a successful manifest refresh.
2. Add a dedicated `WEB_ROUTE_MANIFEST_REFRESH_URL` if the consumer must be a
   different endpoint than `/api/revalidate`.

Prefer option 1 for the first slice: it reuses the existing bearer contract and
lets the web branch decide how to clear or refetch its manifest cache.

Tests:

- Existing webhook tests should cover the new model, missing config, non-2xx,
  and no-throw behavior.

### Unit 6 - Scripts and operator workflow

Add a way to generate or inspect the manifest locally.

Files:

- `apps/admin/package.json`
- `apps/admin/src/scripts/generate-watch-route-manifest.ts`

Behavior:

- `pnpm --filter @forge/admin watch-route-manifest:generate` refreshes the
  snapshot and prints counts, version, generatedAt, and payload size.
- The script must refuse production URLs unless an existing safe script pattern
  permits production operations explicitly.
- Add an optional `--print` mode for local debugging that writes payload to
  stdout; default should avoid dumping large JSON into logs.

Tests:

- If script tests are practical, add
  `apps/admin/src/scripts/generate-watch-route-manifest.test.ts`.
- Otherwise keep service tests as the correctness source and document the
  command in `apps/admin/CLAUDE.md`.

## Consumer Contract for the Web Branch

This branch should not implement the web consumer, but it must leave enough
contract for the current web PR to proceed:

- Web can reject a two-segment route when `contentSlug` is absent or
  `audioLanguageSlug` is absent.
- Web can reject a three-segment route when the parent is absent, the child is
  not listed under that parent, or the audio language slug is absent.
- Web can preserve one-segment localized-home behavior by checking language
  slugs first and `oneSegmentSlugs` second.
- Web should still call the real resolver after manifest admission. The
  manifest is an admission prefilter, not the final content renderer.
- A manifest false negative is worse than a false positive because it 404s
  valid public URLs. Keep data rules conservative and consumer behavior
  observable.

## Scaling Rules

- Manifest generation may scan large tables, but request-time web validation
  must be set membership only.
- Payload growth target is:
  - `O(contentSlugs)`.
  - `O(oneSegmentSlugs)`.
  - `O(parentChildPairs)`.
  - `O(audioLanguageSlugs)`.
- Payload must never be:
  - `O(contentSlugs x audioLanguageSlugs)`.
  - `O(parentChildPairs x audioLanguageSlugs)`.
  - dependent on full `VideoDub` row projection.
- Add size logging and tests that fail if the fanout fixture starts emitting
  per-language route permutations.
- If `episodePairsByParent` becomes too large for edge/proxy memory, switch the
  wire shape to sorted arrays or a compact prefix structure before adding
  language multiplication. Do not solve size by dropping correctness silently.

## Verification

Admin branch validation:

- `pnpm --filter @forge/admin test -- watch-route-manifest`
- `pnpm --filter @forge/admin typecheck`
- `pnpm --filter @forge/admin lint`
- `pnpm --filter @forge/admin schema:print` when GraphQL or Prisma schema
  changes require it.
- If a Prisma model/migration is added, run the admin migration validation path
  used by this repo and verify a fresh local DB can migrate.
- Run the local generate script against a restored admin snapshot and record:
  `contentSlugs`, `oneSegmentSlugs`, `parentChildPairs`,
  `audioLanguageSlugs`, `payloadSizeBytes`, and generation duration.

Web integration validation after merge back:

- Hostile two-segment paths such as `/watch/anything.html/english.html` reject
  before admin GraphQL resolution.
- Hostile three-segment paths such as
  `/watch/jesus.html/anything/english.html` reject before admin GraphQL
  resolution.
- Known valid research-doc paths still render.
- `/watch/easter.html` preserves one-segment collection behavior.
- Public language slugs such as `english.html` are admitted; message keys such
  as `en.html` remain invalid public audio segments.

## Acceptance Criteria

- Admin computes and stores a compact manifest with deterministic ordering and
  versioning.
- Manifest refresh is triggered by Experience changes and route-relevant Core
  sync/import flows without blocking those flows.
- Web can fetch the latest manifest through an authenticated, documented
  contract.
- Manifest payload does not enumerate full language-specific route
  permutations.
- Tests cover draft, delete, soft delete, playable dub, relation, Experience,
  and large-fanout cases.
- Operator docs explain how to refresh and inspect manifest counts locally.

## Open Questions

1. Should the latest manifest be stored only in Postgres first, or should admin
   also push it to the eventual edge-readable store in this slice?
2. Should `audioLanguageSlugs` include every non-deleted language slug, or only
   languages with at least one playable dub? The stricter playable-dub set is
   safer for admission, but may reject newly synced language routes before dub
   sync completes in partial sync windows.
3. Should `contentSlugs` include published Experiences independently of video
   playability? Current web resolution tries Experience after video/series
   misses in some shapes; the implementation must match exact current route
   dispatch.
4. Is `pathSegment` in `ExperienceLocale` currently part of public `/watch`
   routing? If not, keep it out of the manifest until web supports it.
5. Which endpoint will the web branch use to invalidate or refetch the manifest:
   existing `/api/revalidate`, a new route, or an edge-store update outside
   Next?
