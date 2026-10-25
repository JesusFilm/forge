---
id: "feat-175"
title: "Watch cold-path performance follow-up"
owner: "vlad"
priority: "P1"
status: "complete"
start_date: "2026-06-10"
duration: 1
depends_on:
  - "feat-173"
blocks: []
tags:
  - "platform"
  - "web"
  - "watch-page"
  - "performance"
  - "seo"
---

## Problem

The June 10 Watch dev launch audit showed that the already-fixed SEO and
accessibility metadata now render correctly in server HTML, but the cold path
still has two concrete launch risks:

1. The deployed hero is still using the MuxPlayer flag-off branch, where the
   actual LCP poster request does not match the server-rendered preload and the
   HLS player can over-buffer first-load video segments.
2. Open Graph and Twitter metadata use a film-relevant editorial still, but the
   underlying image resolves to 640x300 while the metadata advertises a large
   card.

Repeated TTFB checks also show a cold first response near 1.8 s followed by
fast repeat responses near 0.3 s, so this slice needs to preserve evidence for
cache/topology follow-up rather than changing the canonical domain contract.

## Entry Points - Read These First

1. `docs/plans/2026-06-10-003-fix-watch-cold-path-performance-plan.md` -
   implementation plan for this follow-up.
2. `apps/web/src/components/watch/HeroPlayer.tsx` - hero player backend branch,
   poster URL, and HLS config.
3. `apps/web/src/app/[locale]/[htmlLang]/[...rest]/page.tsx` - server-rendered
   LCP preload that the hero poster must reuse.
4. `apps/web/src/lib/experience-metadata.ts` - Open Graph and Twitter image
   selection for video and episode routes.
5. `docs/solutions/performance-issues/web-watch-route-lighthouse-perf-campaign-lcp-bundle-fonts-20260527.md`
   - prior Watch LCP/HLS tuning playbook.

## Grep These

- `NEXT_PUBLIC_FORGE_WATCH_HERO_MUX_VIDEO`
- `thumbnail.webp?width=1280`
- `_hlsConfig`
- `resolvePosterUrl`
- `DEFAULT_OG_IMAGE`
- `openGraph`
- `twitter`

## What To Build

- [x] Make both HeroPlayer backends use the same Mux poster URL as the route
      preload so the preloaded image can be reused on the flag-off deployment.
- [x] Apply the known HLS buffer caps to the MuxPlayer flag-off backend as well
      as the MuxVideo backend.
- [x] Prefer a 1200x630 Mux JPG social thumbnail for playable Watch video
      metadata when a selected playback id exists.
- [x] Preserve the production `www.jesusfilm.org` canonical and `og:url`
      contract established by feat-160 and feat-173.
- [x] Capture TTFB and Lighthouse/browser-smoke evidence after the patch so
      remaining cold-response work has concrete cache/topology data.

## Constraints

- Do not switch canonical ownership from production `www.jesusfilm.org` to the
  dev `watch.jesusfilm.org` host.
- Do not remove the MuxPlayer branch in this slice; make the current deployed
  flag-off path perform safely.
- Do not hand-edit generated GraphQL env or introspection output.
- Keep the fix scoped to hero cold-path behavior, social metadata image size,
  and verification evidence.

## Verification

- `pnpm --filter @forge/web test -- src/components/watch/__tests__/HeroPlayer.test.tsx src/lib/experience-metadata.test.ts`
- `pnpm --filter @forge/web typecheck`
- `pnpm --filter @forge/web lint`
- Helium smoke on the local Watch route confirms the hero renders without
  regression.
- Lighthouse/mobile smoke or live deployed evidence confirms the LCP poster
  URL and social image metadata behavior before production rollout.

## Plan

Implementation plan:
`docs/plans/2026-06-10-003-fix-watch-cold-path-performance-plan.md`
