---
id: feat-220
title: Make Watch hero Mux poster width responsive
status: complete
lane: platform
depends_on:
  - feat-219
blocks: []
---

## Problem

Mobile Lighthouse identifies the Watch hero poster as the LCP element. The
poster currently hard-codes a Mux `width=1280` thumbnail URL, even though mobile
renders the hero image at a much smaller width.

## Scope

- Build the hero poster base URL without a fixed width.
- Use a Next Image loader to add Mux `width` values from Next's responsive image
  candidate selection.
- Remove the fixed 1280px server preload so the browser does not fetch the wrong
  candidate.

## Verification

1. `pnpm --filter @forge/web test -- src/components/watch/__tests__/HeroPlayer.test.tsx`
2. `pnpm --filter @forge/web run typecheck`
3. `pnpm --filter @forge/web exec eslint src/components/watch/HeroPlayer.tsx src/components/watch/__tests__/HeroPlayer.test.tsx src/app/[locale]/[htmlLang]/[...rest]/page.tsx`
4. Production or preview Lighthouse confirms the LCP image request uses a mobile
   sized Mux width candidate.
