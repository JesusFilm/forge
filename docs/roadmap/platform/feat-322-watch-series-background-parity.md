---
id: "feat-322"
title: "Watch series background parity"
owner: "codex"
priority: "P2"
status: "complete"
start_date: "2026-07-31"
duration: 1
depends_on: []
blocks: []
tags:
  - "platform"
  - "web"
  - "watch"
  - "ui"
---

## Problem

Watch series pages use a translucent, blurred stone background behind the
description and language controls, but switch to poster-derived animated image
layers behind the episode thumbnails. The abrupt visual change makes the lower
page feel disconnected from the metadata section.

## Entry Points - Read These First

1. `apps/web/src/components/watch/SeriesPageClient.tsx` - series page
   composition and metadata background treatment.
2. `apps/web/src/components/watch/SeriesEpisodesGrid.tsx` - episode grid and
   poster-derived backdrop layers.
3. `apps/web/src/components/watch/SeriesEpisodeCard.tsx` - episode card and the
   former delegated-backdrop data hook.
4. `apps/web/src/components/watch/__tests__/SeriesEpisodesGrid.test.tsx` - grid
   structure, navigation, and background coverage.
5. `apps/web/next.config.mjs` and `apps/web/src/proxy.ts` - narrowly scoped
   canonical-origin and loopback rewrite support for remote visual QA.

## Grep These

- `series-page-meta`
- `series-episodes-grid-wrapper`
- `series-episodes-grid-backdrop`
- `backdrop-blur-2xl`

## What To Build

1. Make the episode thumbnail area use the same translucent stone background,
   backdrop blur, and saturation treatment as the series metadata section.
2. Remove the poster-derived crossfade, pan/zoom, and tint layers that compete
   with the shared page treatment.
3. Preserve episode card layout, Mux hover previews, navigation, accessible
   names, and responsive spacing.
4. Update focused component tests to assert the shared background contract.
5. Keep the HTTPS remote-QA path usable without changing production rewrite
   behavior or hardcoding a machine-specific Tailscale origin.

## Constraints

- Do not change series content, hero controls, download/share behavior, or
  language selection.
- Do not change episode card image selection or hover-preview behavior.
- Do not add new assets, gradients, or motion.

## Verification

- Focused Vitest coverage for Next config, the Watch proxy, the series grid,
  and the series page client.
- `pnpm --filter @forge/web lint`
- `pnpm --filter @forge/web typecheck`
- Prettier check for all changed files.
- Browser smoke the series page at desktop and narrow viewports and confirm the
  metadata and episode surfaces render as one continuous treatment.
- Compare page-load resources before and after; the change must not add image
  requests or client initialization work.
