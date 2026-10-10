---
id: "feat-177"
title: "Watch non-Cloudflare performance hardening"
owner: "vlad"
priority: "P1"
status: "complete"
start_date: "2026-06-11"
duration: 2
depends_on:
  - "feat-176"
blocks: []
tags:
  - "platform"
  - "web"
  - "watch-page"
  - "performance"
  - "seo"
---

## Problem

The Watch dev launch fixes now server-render core SEO metadata and render the
hero poster before delayed media startup, but the app still has non-Cloudflare
cold-path work before production cutover.

Live checks showed three remaining app-owned risks:

1. The watch hero can still be built with the old MuxPlayer backend through
   `NEXT_PUBLIC_FORGE_WATCH_HERO_MUX_VIDEO`, even though the optimized MuxVideo
   path is the desired production behavior.
2. Localized watch routes are unhealthy or slow: some return 500 and others
   take tens of seconds, pointing at the heavy localized fallback resolver path.
3. Initial page data and JS remain heavier than needed, especially language
   picker data and transcript/client interaction code that should not all sit
   on the first-load path.

Cloudflare HTML caching is intentionally deferred until app behavior is stable.
This ticket fixes the app surface first.

## Entry Points - Read These First

1. `docs/plans/2026-06-11-001-fix-watch-non-cloudflare-performance-plan.md` -
   implementation plan for this follow-up.
2. `apps/web/src/components/watch/HeroPlayer.tsx` - hero backend selection,
   poster-first activation, and MuxVideo props.
3. `apps/web/src/lib/content.ts` - watch video resolver, localized fallback,
   and cache boundaries.
4. `apps/web/src/lib/fragments/watch-video.ts` - admin GraphQL projections
   that currently combine shell, copy, Dubs, downloads, and subtitles.
5. `apps/web/src/components/watch/WatchPageClient.tsx` - client payload,
   modal boundaries, language picker data, and transcript wiring.
6. `apps/web/src/components/watch/SubtitleTranscript.tsx` - current
   browser-side VTT fetch and transcript rendering.
7. `docs/solutions/performance-issues/web-watch-route-lighthouse-perf-campaign-lcp-bundle-fonts-20260527.md`
   - prior Watch LCP, bundle, and Mux player tuning.

## Grep These

- `NEXT_PUBLIC_FORGE_WATCH_HERO_MUX_VIDEO`
- `FORGE_WATCH_HERO_MUX_VIDEO_DEFAULT`
- `fetchWatchVideoWithContentFallback`
- `getWatchVideoBySlugOperation`
- `variantsForLanguagePicker`
- `SubtitleTranscript`
- `videoDub(id`
- `watch_route_manifest`

## What To Build

1. Remove the watch hero MuxPlayer rollout flag and make the optimized
   MuxVideo path the only HeroPlayer backend.
2. Split the watch video server resolver into a slug-level shell, selected Dub
   details, and lightweight localized-copy fallback queries.
3. Keep SEO-bearing content server-rendered, including metadata, page copy,
   study questions, and the selected audio transcript text.
4. Move language picker options out of the initial client payload and load slim
   options only when the language modal opens.
5. Keep Cloudflare cache rules, ISR TTL changes, and canonical ownership
   changes out of this slice.

## Constraints

- Do not change the public `/watch/{slug}.html/{language}.html` URL contract.
- Do not switch canonical, `og:url`, or Twitter URL ownership from production
  `www.jesusfilm.org` to `watch.jesusfilm.org`.
- Do not client-render SEO-critical metadata, localized copy, study questions,
  or transcript text.
- Do not add a new admin GraphQL field unless existing `videoBySlug` and
  `videoDub(id)` cannot supply the needed split payloads.
- Do not hand-edit generated GraphQL env or introspection output.
- Do not add Cloudflare rules in this slice.

## Verification

- Focused web tests for HeroPlayer, watch content resolver, metadata,
  transcript rendering, language picker loading, and route regressions pass.
- Admin GraphQL codegen/type checks pass if any admin SDL or operation shape
  changes.
- Helium smoke on `watch.jesusfilm.org` confirms initial HTML keeps SEO
  content, one H1, poster-first hero, and no MuxPlayer element.
- Live route probes confirm English, Romanian, Russian, Spanish, Bangla, and
  German watch URLs no longer 500 or hang for tens of seconds.
- Browser resource timing confirms the hero no longer fetches MuxPlayer/cast
  code and language options are not serialized into the initial page payload.

## Plan

Implementation plan:
`docs/plans/2026-06-11-001-fix-watch-non-cloudflare-performance-plan.md`
