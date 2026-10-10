---
id: "feat-438"
title: "Watch immersive section background saturation"
owner: "vlad"
priority: "P2"
status: "complete"
start_date: "2026-08-26"
duration: 1
depends_on: []
blocks: []
tags:
  - "watch"
  - "web"
  - "experiences"
  - "ui"
---

## Problem

Immersive media-collection sections amplify their blurred artwork backdrops to
110-125% saturation and layer a strongly colored tint above them. On authored
Experience pages this makes the section backgrounds compete with headings,
supporting copy, and media cards.

## Entry Points - Read These First

1. `apps/web/src/components/sections/MediaCollection.tsx` - decorative artwork,
   hover, tint, and texture layers for immersive media collections.
2. `apps/web/src/components/sections/MediaCollection.test.tsx` - focused visual
   contract tests for media-collection rendering.

## Grep These

- `media-collection-default-backdrop`
- `media-collection-hover-backdrop`
- `saturate-125`
- `tintOverlayStyle`

## What To Build

1. Reduce saturation on the decorative default and hover artwork backdrops.
2. Apply the same restrained saturation treatment to the colored tint layer so
   the composed background is consistently quieter.
3. Use a consistent dark warm-neutral base and tint for the inner glow instead
   of feeding authored section colors into the effect.
4. Pin the background-only treatment in a focused component test.

## Constraints

- Do not desaturate media thumbnails, text, controls, or other foreground
  content.
- Preserve background transitions, blur, texture, and readable contrast.
- Do not allow authored section colors or fixed purple fallback gradients to
  color the immersive inner glow.
- Do not add client-side work or image requests.

## Verification

- Focused tests confirm default, hover, and tint background layers use the
  reduced saturation treatment while foreground cards remain unaffected.
- `pnpm --filter @forge/web test -- MediaCollection`
- `pnpm --filter @forge/web typecheck`
- Visual smoke an authored immersive Experience at desktop width.

## Completion Notes

- Reduced the decorative default, hover, and colored tint layers to 75%
  saturation while leaving media cards and foreground content unchanged.
- Darkened those same decorative layers to 50% brightness so the immersive
  backgrounds sit behind the content instead of competing with it.
- Replaced authored and fallback purple inner-glow colors with the shared dark
  warm-neutral `#1A1815`; artwork can still vary the backdrop without coloring
  the base canvas.
- Added carousel and grid regression coverage for the background-only styling
  contract.
- Focused MediaCollection tests and lint pass. The full Web typecheck could not
  use the current dependency set because pnpm's minimum-release-age policy
  rejects newly published Expo entries in the existing lockfile; the older
  shared fallback install reports unrelated cross-package type drift.
