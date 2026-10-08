---
id: "feat-647"
title: "Preserve Watch language routes across hreflang collisions"
owner: "vlad"
priority: "P1"
status: "complete"
start_date: "2026-10-08"
completed_date: "2026-10-08"
duration: 1
depends_on: []
blocks: []
tags:
  - "platform"
  - "admin"
  - "web"
  - "watch-page"
  - "seo"
---

## Problem

The Admin Watch SEO manifest de-duplicates language rows by normalized
hreflang before returning them. Web derives both sitemap `<loc>` URLs and
`xhtml:link` annotations from that same list, so every second language sharing
a code such as `es` or `ar` disappears from sitemap locations.

## Entry Points - Read These First

1. `apps/admin/src/services/watch-seo-manifest.service.ts` - route inventory,
   hreflang normalization, and language row queries.
2. `apps/web/src/lib/watch-seo-manifest.ts` - consumer contract and cached
   manifest parser.
3. `apps/web/src/lib/watch-sitemap.ts` - canonical locations, alternate links,
   and byte-aware sitemap chunking.
4. `docs/solutions/performance-issues/watch-hreflang-sitemap-manifest-20260612.md`
   - sitemap-only hreflang ownership and shard limits.

## What To Build

1. Preserve all public language slugs with a supported normalized hreflang as
   route locations in each Admin video and episode group.
2. Keep the hreflang annotations unique per normalized code and select the
   holder using summed Core `country_language.speakers`; use language slug as
   a deterministic tie-breaker.
3. Let Web emit every manifest route slug as a `<loc>`. The selected holder
   routes keep the unique annotation graph; collision losers get a standalone
   `<loc>` without hreflang tags. Continue accepting older manifest snapshots
   without the route inventory field.
4. Keep unsupported tags excluded and counted, preserve reciprocal sitemap
   annotations, and enforce current URL-count and uncompressed-byte shard
   limits.

## Verification

- Admin service tests prove all colliding slugs survive as route locations and
  the highest speaker total wins the annotation, with stable ordering.
- Web parser and sitemap tests prove collision-loser locations are emitted,
  annotation codes remain unique, old manifests remain readable, and chunking
  continues to include all locations.
- Run focused Admin/Web sitemap tests, typecheck, lint, and formatting checks
  before opening the PR.
