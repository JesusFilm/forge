---
title: "Keep Watch Search and Social Metadata Separate from Video Identity"
date: "2026-08-01"
category: "architecture-patterns"
module: "Admin VideoLocale and Web Watch metadata"
problem_type: "architecture_pattern"
component: "service_object"
severity: "high"
applies_when:
  - "Crawler or social metadata must differ from localized viewer-facing copy without changing canonical content identity"
  - "An upstream sync owns visible localized fields while editors need durable per-locale promotional overrides"
  - "A public consumer needs managed social art without receiving Admin storage details or private URLs"
tags:
  - "watch"
  - "seo"
  - "social-metadata"
  - "video-locale"
  - "media-assets"
  - "graphql"
  - "structured-data"
  - "revalidation"
related_components:
  - "database"
  - "testing_framework"
---

# Keep Watch Search and Social Metadata Separate from Video Identity

## Context

Watch pages need to improve search intent and social-card presentation without rewriting the title and description viewers recognize as the video's identity. The reusable boundary is a localized promotional overlay: the visible `VideoLocale` fields stay canonical, while nullable `searchTitle`, `searchDescription`, and `socialImageAssetId` fields sit beside them (`apps/admin/prisma/schema.prisma:1260`, `apps/admin/prisma/schema.prisma:1265`).

This pattern is implemented in open PR [#1798](https://github.com/JesusFilm/forge/pull/1798) and is pending merge as of 2026-08-01. It does not imply that the migration or initial JESUS metadata has reached any deployed environment.

## Guidance

### Put the overlay at the localization boundary

Store optional search and social fields on `VideoLocale`, not on `Video` and not in a route-specific exception. Null means "inherit the selected locale's normal content" rather than "publish blank metadata." Core sync continues to own visible localized fields; editors own only the promotional overlay (`apps/admin/prisma/schema.prisma:1264`).

Store a managed `MediaAsset` identity instead of an arbitrary image URL. The relation uses `onDelete: Restrict`, and the save service accepts only public, ready image assets with a resolvable object or preview key (`apps/admin/prisma/schema.prisma:1268`, `apps/admin/src/services/video-search-social.service.ts:164`). This keeps Media Library lifecycle and usage controls authoritative.

### Evolve shared contracts additively

Add nullable fields to the established `WatchRouteSnapshotLocale` GraphQL type instead of replacing that type. Admin exposes `searchTitle`, `searchDescription`, and a public-safe `socialImage`; older consumers can continue treating the additions as absent (`apps/admin/src/graphql/types/video.ts:1124`, `apps/admin/src/graphql/types/video.ts:1137`). Regenerate the committed Admin schema and consumer types in the same change.

Hydrate referenced assets only after the bounded root-locale set is known. Deduplicate IDs, query public ready image assets in one batch, and project only URL, dimensions, and MIME type (`apps/admin/src/services/video.service.ts:923`, `apps/admin/src/services/video.service.ts:931`). If an asset cannot be resolved publicly, return no override and let Web use its existing fallback.

Preserve the real MIME type end to end. Admin includes `mimeType`, Web trims and normalizes it, and Open Graph emits it only when known (`apps/admin/src/services/video.service.ts:957`, `apps/web/src/lib/content.ts:681`, `apps/web/src/lib/experience-metadata.ts:138`). Do not label every managed image as JPEG.

### Resolve one page presentation, but keep structured identity separate

Treat blank overrides as absent. Resolve the page title from `searchTitle` or the localized title plus the normal suffix, and resolve the description from `searchDescription`, localized description, or snippet (`apps/web/src/lib/experience-metadata.ts:208`). Reuse those resolved values for HTML, Open Graph, and Twitter metadata so channels do not drift (`apps/web/src/lib/experience-metadata.ts:281`). An override is the complete final title; do not append the brand suffix twice.

Choose a managed social image first, then preserve the Mux, poster, and site-default fallback chain (`apps/web/src/lib/experience-metadata.ts:225`, `apps/web/src/lib/experience-metadata.ts:237`).

Do not feed promotional overrides into visible headings, canonical URLs, or `VideoObject`. Structured data takes its name and description from canonical localized video copy, and its thumbnail stays on the Mux/poster media-identity path (`apps/web/src/lib/experience-metadata.ts:209`, `apps/web/src/lib/experience-metadata.ts:217`, `apps/web/src/lib/experience-metadata.ts:258`). The JSON-LD serializer consumes those dedicated structured-data fields (`apps/web/src/lib/watch-structured-data.ts:268`).

### Keep persistence authoritative and revalidation best effort

Validate and save the overlay transactionally. After commit, dispatch route revalidation without awaiting the webhook (`apps/admin/src/services/video-search-social.service.ts:151`, `apps/admin/src/services/video-search-social.service.ts:209`). A slow or unavailable cache endpoint must not turn a valid editorial save into a failure.

### Verify targeted release data without mutating it

When a migration initializes narrowly targeted metadata, pair it with a read-only promotion check. Migration `0047` tolerates an absent row, aborts on multiple English JESUS candidates, and writes only when exactly one candidate exists (`apps/admin/prisma/migrations/0047_video_locale_search_social_metadata/migration.sql:28`, `apps/admin/prisma/migrations/0047_video_locale_search_social_metadata/migration.sql:62`).

The verifier independently requires exactly one candidate, the exact approved title and description, and no social-image override, then exits nonzero on mismatch or query failure (`apps/admin/src/scripts/verify-video-search-social-seed.ts:22`, `apps/admin/src/scripts/verify-video-search-social-seed.ts:45`). Run `pnpm --filter @forge/admin verify:video-search-social-seed` against every target environment that is expected to contain the record (`apps/admin/package.json:44`). Migration presence alone is not evidence that target data matched.

## Why This Matters

The boundary lets editorial and SEO teams improve click-through intent without changing viewer-visible identity or structured media truth. It also narrows failures: missing text falls back to canonical localized copy, an unusable image falls back to existing media, and revalidation failure does not roll back a committed edit.

The same separation keeps rollout compatible in the safe direction: nullable storage and additive GraphQL fields let Admin roll out ahead of older Web consumers. Deploy the Admin schema before the Web build that queries the new fields. A managed asset ID remains stable even when delivery URLs change.

## When to Apply

- A localized content entity needs channel-specific crawler or sharing copy.
- Editors need governed social art from the Media Library.
- A shared GraphQL locale contract must evolve without breaking existing consumers.
- Cached public routes should refresh after edits without coupling persistence to Web availability.
- A release depends on exact environment-specific initialization that must be verified read-only.

Do not use this pattern to create a second visible title, an independent SEO publication lifecycle, arbitrary image URLs, or a replacement structured-data identity.

## Examples

With no overrides, a localized video uses its normal suffixed page title, localized description or snippet, and the existing image fallback chain. Its visible title and `VideoObject.name` remain canonical.

With the search title `Watch JESUS — Full Movie Free Online | Jesus Film Project`, HTML, Open Graph, and Twitter use that exact value. The visible title and `VideoObject.name` remain `JESUS` because they use separate canonical fields (`apps/web/src/lib/experience-metadata.ts:209`, `apps/web/src/lib/experience-metadata.ts:281`).

With a public ready WebP asset, Admin projects `image/webp`, Web emits that MIME type for the social image, and JSON-LD still uses the Mux/poster thumbnail path. If the managed asset becomes unusable, the public snapshot omits it and Web falls back safely.

## Related

- [Admin data-model decisions](../cms/admin-app-data-model-decisions.md) establishes `VideoLocale` as the audience-bound metadata grain.
- [Asset-backed Admin media picker pattern](../best-practices/admin-asset-backed-experience-media-picker-pattern-20260707.md) explains managed asset identity at rest and public-safe projection at read time.
- [Watch static-locale route admission](../performance-issues/watch-static-locale-rewrite-route-manifest-admission-20260529.md) protects canonical route identity and complete revalidation coverage.
- [Watch hreflang sitemap manifest](../performance-issues/watch-hreflang-sitemap-manifest-20260612.md) separates page-owned crawler metadata from the route inventory.
- [Watch cold-path performance follow-up](../performance-issues/watch-cold-path-performance-follow-up-20260610.md) documents the Mux social image that remains the fallback beneath a managed override.
- [Admin-owned Watch Route Manifest](admin-owned-watch-route-manifest-20260530.md) explains why rendering metadata belongs in the page snapshot rather than the route-admission manifest.
