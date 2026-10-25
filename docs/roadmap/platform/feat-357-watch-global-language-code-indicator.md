---
id: "feat-357"
title: "Watch global language code indicator"
owner: "vlad"
priority: "P1"
status: "complete"
start_date: "2026-08-12"
duration: 1
depends_on:
  - "feat-245"
  - "feat-260"
blocks: []
tags:
  - "platform"
  - "web"
  - "watch-page"
  - "language-picker"
  - "ui"
---

## Problem

The floating Watch header shows the active language code on single-video and
series pages, but its global fallback renders only the globe. Home, language
home, experience, inventory, history, and utility pages should display the
same compact active-language indicator.

## Entry Points — Read These First

1. `apps/web/src/components/FloatingSearchProvider.tsx` — resolves the current
   route language and chooses between page-specific and global language-picker
   ownership.
2. `apps/web/src/lib/language-code.ts` — canonical Watch slug-to-code helper.
3. `apps/web/src/components/__tests__/FloatingSearchProvider.test.tsx` — shared
   header route-family and ownership regression coverage.

## Grep These

- `headerLanguageCode`
- `currentLanguageSlug`
- `floating-header-language-code`
- `languageCodeFor`

## What To Build

1. Derive a compact language code from the global fallback's current public
   language slug.
2. Render that code beside the globe on every shared-header route while
   preserving page-specific video and series language-code ownership.
3. Add regression coverage for home, localized utility, experience, and inner
   Watch routes.

## Constraints

- Do not change language routes, preference persistence, picker options, or
  lazy-loading behavior.
- Keep page-specific video and series switchers authoritative when registered.
- Reuse the existing canonical language-code helper; do not add a second map.

## Verification

- `pnpm --filter @forge/web test -- src/components/__tests__/FloatingSearchProvider.test.tsx`
- `pnpm --filter @forge/web typecheck`
- `pnpm --filter @forge/web lint`
- Browser smoke on the Watch home page and a non-video route at mobile and
  desktop widths.
