---
title: "Move Watch Hreflang from Page Heads to Sitemap Manifests"
date: "2026-06-12"
category: "performance-issues"
module: "apps/web watch seo"
problem_type: "performance_issue"
component: "frontend_nextjs"
symptoms:
  - "Representative Watch video HTML reached 1.23 MB with 2,094 page-head alternate links"
  - "Page render rebuilt the full playable language alternate graph"
  - "Crawler-facing hreflang annotations were duplicated between page metadata and future sitemap ownership"
root_cause: "unbounded_page_metadata"
resolution_type: "code_fix"
severity: "high"
related_components:
  - "apps/admin"
  - "apps/web"
  - "seo"
tags:
  - "watch"
  - "hreflang"
  - "sitemap"
  - "metadata"
  - "route-manifest"
  - "seo-manifest"
---

# Move Watch Hreflang from Page Heads to Sitemap Manifests

## Problem

Watch video metadata previously built `alternates.languages` from every
playable Dub variant. High-language videos therefore serialized thousands of
`rel="alternate" hreflang` links into each HTML response and paid the graph
construction cost during page rendering.

That design also created two owners for the same crawler signal once sitemap
coverage became necessary: page metadata and sitemap XML. Duplicate ownership
made validation, cache invalidation, and release QA harder than the underlying
SEO requirement.

## Decision

Watch uses sitemap XML as the only hreflang source of truth.

Page metadata keeps canonical, Open Graph, Twitter, robots, and structured
data, but it does not populate `alternates.languages` for Watch video or
episode routes. Google treats HTML, HTTP header, and sitemap hreflang
annotations as equivalent signals, so a valid sitemap graph is enough without
shipping the same graph in every page head.

## Implementation

Admin now persists a dedicated SEO manifest snapshot in
`watch_seo_manifest_snapshot` and serves it from
`GET /api/watch-seo-manifest` with the normal consumer bearer and `ETag`
support. The manifest is separate from the route manifest:

- The route manifest remains a compact route-admission contract.
- The SEO manifest carries sitemap rendering data: video route groups,
  episode route groups, valid hreflang values, public language slugs, and a
  skipped-value summary.

The generator accepts only Google-supported hreflang values in the simple
language or language-region shape, such as `en` or `pt-BR`. Unsupported script
or numeric-region tags, missing tags, and duplicate normalized hreflang values
are skipped and counted instead of emitted.

Web reads the SEO manifest through `src/lib/watch-seo-manifest.ts`, keeps a
short process-local cache, and renders:

- `/watch/sitemap.xml` as a sitemap index.
- `/watch/sitemap/{id}.xml` as byte-aware child sitemap chunks.

Each child sitemap entry uses an absolute canonical `www.jesusfilm.org/watch`
URL and self-inclusive `xhtml:link` alternates for the route group. Chunking is
bounded by both URL count and uncompressed byte size, not URL count alone.

## Revalidation

Core sync phases `languages`, `videos`, and `video-dubs` refresh the admin SEO
manifest snapshot and emit `model: "watch-seo-manifest"` to Web. Web clears the
receiving process's SEO manifest cache, invalidates the SEO manifest cache tag,
and revalidates the sitemap index plus child sitemap routes.

The cache is process-local, like the route manifest cache. If a different Web
replica misses the webhook, its fallback is the short manifest TTL. Sitemap
routes fail closed with a controlled 503 when no valid snapshot is available;
Watch page metadata does not depend on the SEO manifest and continues to render
without hreflang.

## Verification

Minimum verification for future changes in this area:

```bash
pnpm --filter @forge/admin test -- src/services/watch-seo-manifest.service.test.ts src/services/watch-seo-manifest-store.test.ts src/app/api/watch-seo-manifest/route.test.ts src/services/watch-seo-manifest-refresh.service.test.ts src/scripts/generate-watch-seo-manifest.test.ts
pnpm --filter @forge/web test -- src/lib/experience-metadata.test.ts src/lib/watch-seo-manifest.test.ts src/lib/watch-sitemap.test.ts src/app/sitemap.test.ts src/app/robots.test.ts src/app/api/revalidate/route.test.ts src/lib/watch-cache-tags.test.ts src/proxy.test.ts
```

Release proof should include one rendered video URL and one episode URL:

- Page HTML has zero `rel="alternate" hreflang` links.
- Canonical and social URLs still point at `https://www.jesusfilm.org/watch`.
- `/watch/sitemap.xml` returns a valid sitemap index.
- At least one child sitemap returns valid XML with the audited route's
  alternate graph.
- Unsupported and duplicate hreflang values are absent from XML and visible in
  skipped summary counts.

## Prevention

Do not reintroduce Watch page-head hreflang as a capped or high-confidence
subset. That creates mixed ownership and can drift from sitemap XML. If a route
needs localized metadata beyond canonical/social fields, add it to the sitemap
manifest or a purpose-built manifest rather than rebuilding the alternate graph
inside page metadata.
