---
id: "feat-173"
title: "Watch dev launch-readiness audit fixes"
owner: "vlad"
priority: "P1"
status: "complete"
start_date: "2026-06-10"
duration: 2
depends_on: []
blocks: []
tags:
  - "platform"
  - "web"
  - "watch-page"
  - "seo"
  - "accessibility"
  - "performance"
---

## Problem

The Watch dev server page at
`https://watch.jesusfilm.org/watch/life-of-jesus-gospel-of-john.html/english.html`
is close to production parity, but the June 9 audit found launch-readiness
gaps before the redesigned app can replace the production
`https://www.jesusfilm.org/watch/...` surface. The canonical URL pointing at
`www.jesusfilm.org` is expected because `watch.jesusfilm.org` is the dev
server, but the page still showed slug-based social titles, a generic stock
social image, missing hreflang and structured data, an accessibility language
warning, empty image-alt warnings, duplicate-H1 risk, and slow mobile LCP.

## Entry Points - Read These First

1. `docs/plans/2026-06-10-001-fix-watch-dev-launch-readiness-plan.md` -
   implementation plan for this audit slice.
2. `apps/web/src/lib/experience-metadata.ts` - shared watch metadata builder
   for canonical, Open Graph, Twitter, robots, and future alternates.
3. `apps/web/src/app/[locale]/[htmlLang]/[...rest]/page.tsx` - two-segment
   and three-segment watch route metadata, LCP preload, and page rendering.
4. `apps/web/src/app/[locale]/[htmlLang]/layout.tsx` - server-rendered
   `<html lang>` and watch resource hints.
5. `apps/web/src/lib/content.ts` and `apps/web/src/lib/fragments/watch-video.ts`
   - admin-backed video, Dub, image, and localized metadata shapes.
6. `apps/web/src/components/watch/HeroPlayer.tsx` and
   `apps/web/src/components/watch/WatchBody.tsx` - H1/title semantics and
   hero LCP behavior.
7. `docs/roadmap/platform/feat-160-watch-public-metadata-origin.md` - completed
   public-origin contract that keeps dev metadata canonicalized to production.
8. `docs/solutions/performance-issues/web-watch-route-lighthouse-perf-campaign-lcp-bundle-fonts-20260527.md`
   - prior Watch route LCP and bundle findings.

## Grep These

- `getWatchPageMetadata`
- `generateSeriesMetadata`
- `resolveWatchVideoBySlug`
- `DEFAULT_OG_IMAGE`
- `alternates:`
- `application/ld+json`
- `hero-player-overlay-title`
- `watch-body-title`
- `NEXT_PUBLIC_FORGE_WATCH_HERO_MUX_VIDEO`
- `thumbnail.webp?width=1280`

## What To Build

1. Make two- and three-segment video metadata use the resolved watch video
   title, description, language, image, and selected Dub instead of falling
   back to route slugs or generic imagery.
2. Keep canonical and `og:url` on `https://www.jesusfilm.org/watch/...` for
   dev, preview, and watch-only deployments, with regression tests.
3. Populate Open Graph and Twitter title, description, and image fields from
   the same resolved metadata source so shared links show readable titles and
   film-relevant stills.
4. Add page-level structured data for playable watch videos and episodes using
   sanitized native JSON-LD script output.
5. Add hreflang alternates from playable Dubs using public audio-language URL
   slugs and BCP-47 language tags, with duplicate-language and unsupported-row
   handling.
6. Verify server-rendered `<html lang>` for the public dev URL path and patch
   only if the raw HTML misses it.
7. Lock the page to one semantic H1, classify empty-alt images as decorative or
   informative, and add focused regression coverage.
8. Recheck mobile LCP on the dev server and apply targeted remediation from the
   existing Watch performance playbook rather than starting a broad bundle
   rewrite.

## Constraints

- Do not change the public `/watch/{slug}.html/{language}.html` URL contract.
- Do not switch canonical ownership from production `www.jesusfilm.org` to the
  dev `watch.jesusfilm.org` host.
- Do not import Core, Algolia, or legacy watch-app code into `apps/web`.
- Do not use request-time dynamic APIs in cacheable Watch render trees.
- Do not hand-edit generated GraphQL env or introspection output.
- Keep decorative images decorative; only add visible alt text for
  content-bearing images.

## Verification

- `pnpm --filter @forge/web test -- src/lib/experience-metadata.test.ts src/lib/__tests__/experience-metadata-watch-page.test.ts src/app/[locale]/[htmlLang]/[...rest]/__tests__/page-routing.test.tsx src/components/watch/__tests__/HeroPlayer.test.tsx src/components/watch/__tests__/WatchBody.test.tsx`
- `pnpm --filter @forge/web typecheck`
- `pnpm --filter @forge/web lint`
- Helium smoke on the dev server URL confirms readable title/OG/Twitter tags,
  production canonical URL, one H1, raw server-rendered `<html lang>`, JSON-LD,
  hreflang entries, and no regression in the LCP preload.
- Lighthouse mobile smoke records LCP, Speed Index, Total Blocking Time, and
  request/chunk changes against the June 9 audit baseline.
