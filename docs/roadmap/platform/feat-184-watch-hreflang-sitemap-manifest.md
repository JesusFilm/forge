---
id: "feat-184"
title: "Watch sitemap-only hreflang manifest"
owner: "vlad"
priority: "P1"
status: "complete"
start_date: "2026-06-12"
completed_date: "2026-06-12"
duration: 2
depends_on: []
blocks:
  - "feat-302"
tags:
  - "platform"
  - "web"
  - "admin"
  - "watch-page"
  - "seo"
  - "performance"
---

## Problem

Release QA on the staging Watch page found that high-language videos now emit
the full playable-Dub hreflang graph in every page head. One representative
URL emitted 2,094 alternate links, roughly 270 KB of alternate tags, and a
1.23 MB raw HTML response. That creates a production release blocker: the page
HTML is too large, cold renders rebuild SEO alternate data from the page
resolver, and page-head hreflang duplicates a graph that should be owned by
the generated sitemap.

## Entry Points - Read These First

1. `docs/plans/2026-06-12-002-perf-watch-hreflang-sitemap-plan.md` -
   implementation plan for this follow-up.
2. `apps/web/src/lib/experience-metadata.ts` - current canonical, social, and
   `alternates.languages` builder.
3. `apps/web/src/app/[locale]/[htmlLang]/[...rest]/page.tsx` - video and
   episode metadata call sites.
4. `apps/web/src/app/robots.ts` - current sitemap TODO and crawler policy.
5. `apps/admin/src/services/watch-route-manifest.service.ts` - existing
   Admin-owned manifest generation pattern.
6. `apps/admin/src/app/api/watch-route-manifest/route.ts` - bearer-gated
   snapshot endpoint with `ETag`.
7. `apps/web/src/lib/watch-route-manifest.ts` - Web manifest cache and
   conditional fetch pattern.
8. `docs/solutions/architecture-patterns/admin-owned-watch-route-manifest-20260530.md`
   - producer-owned manifest guidance and boundaries.

## Grep These

- `buildWatchVideoAlternateLanguages`
- `alternatesLanguages`
- `generateWatchVideoMetadata`
- `MetadataRoute.Sitemap`
- `sitemap`
- `watch-route-manifest`
- `audioLanguageIndexesByContent`
- `languageSlug`
- `hreflang`

## What To Build

1. Add an Admin-owned Watch SEO manifest snapshot that precomputes route
   groups, valid hreflang alternates, and public language slugs without
   putting rendering payloads in the route manifest.
2. Add an authenticated Admin endpoint and refresh path for the SEO manifest,
   mirroring the existing route manifest lifecycle.
3. Add a Web manifest client/cache that serves sitemap generation without
   rebuilding the alternate graph in page metadata.
4. Add a Watch sitemap index and chunked sitemap XML so the full valid
   alternate graph lives in sitemap output under sitemap size limits.
5. Remove Watch page-head `hreflang` entirely while preserving canonical,
   Open Graph, Twitter, robots, and structured data metadata.
6. Update `robots.ts` to advertise the sitemap index after sitemap routes
   exist.
7. Capture release proof showing the audited page emits zero page-head
   `hreflang` alternates while the full alternate graph remains discoverable
   in sitemap XML.

## Constraints

- Do not change public Watch URL shapes:
  `/watch/{slug}.html/{language}.html` and
  `/watch/{series}.html/{episode}/{language}.html`.
- Do not switch canonical, Open Graph, Twitter, or sitemap ownership from
  `https://www.jesusfilm.org/watch/...`.
- Do not use internal UI locale keys such as `en` or `es` as public Watch
  language URL segments.
- Do not overload the existing route manifest with SEO/rendering payloads.
- Do not emit unsupported or duplicate hreflang tags in sitemap XML.
- Do not emit any `rel="alternate" hreflang` tags from Watch page HTML.
- Do not client-render or defer SEO-critical metadata.
- Do not use Cloudflare HTML cache changes as the primary fix for oversized
  page HTML.

## Verification

- Focused Admin tests cover SEO manifest generation, skipped hreflang summary,
  snapshot persistence, endpoint auth, `ETag`, and refresh triggers.
- Focused Web tests cover SEO manifest parsing/cache behavior, revalidation
  cache clearing, sitemap index/chunk XML, robots sitemap discovery, canonical
  URL ownership, and zero page-head `hreflang`.
- `pnpm --filter @forge/admin test -- watch-seo-manifest`
- `pnpm --filter @forge/web test -- src/lib/experience-metadata.test.ts src/app/sitemap.test.ts src/app/robots.test.ts src/lib/watch-seo-manifest.test.ts`
- `pnpm --filter @forge/admin typecheck`
- `pnpm --filter @forge/web typecheck`
- `pnpm --filter @forge/admin lint`
- `pnpm --filter @forge/web lint`
- Focused metadata tests confirm Watch video and episode metadata no longer
  emits page-head `hreflang`; deployed HTML fetch proof should be rerun after
  the PR lands against real admin data.
- Helium/agent-browser smoke confirms the local sitemap index and one child
  sitemap route return valid XML with canonical absolute Watch URLs.

## Plan

Implementation plan:
`docs/plans/2026-06-12-002-perf-watch-hreflang-sitemap-plan.md`
