---
id: "feat-302"
title: "Close Watch search from the header logo"
owner: "codex"
priority: "P2"
status: "complete"
start_date: "2026-07-23"
duration: 1
depends_on: []
blocks: []
tags:
  - "web"
  - "watch"
  - "search"
  - "modal"
  - "navigation"
  - "accessibility"
---

## Problem

The persistent Watch header keeps its logo visible while the global search
modal is open. Clicking that logo follows its normal home destination, which
unexpectedly navigates away instead of dismissing the active search surface.

## Entry Points - Read These First

1. `apps/web/src/components/FloatingSearchProvider.tsx` - persistent header
   logo, search open/closing state, and shared close/reset boundary.
2. `apps/web/src/components/__tests__/FloatingSearchProvider.test.tsx` -
   focused header, navigation, close-animation, and search reset coverage.
3. `docs/roadmap/content-discovery/feat-250-watch-search-close-reset.md` -
   established requirement that all close paths use the provider boundary.

## Grep These

- `floating-header-logo`
- `modalChromeHidden`
- `setOpen(false)`
- `WATCH_MODAL_CLOSE_DELAY_MS`

## What To Build

1. Intercept the persistent header logo click while search is open or closing.
2. Prevent the logo's normal home navigation and close search through the
   provider-owned boundary so query/results reset behavior stays consistent.
3. Preserve the logo's existing destination and navigation behavior whenever
   search is closed.
4. Add focused regression coverage proving the open-modal click is canceled and
   the modal completes its close lifecycle.

## Constraints

- Do not change the logo destination for any Watch route or language.
- Do not change modal geometry, instant-shell loading, autofocus, language
  controls, cached metadata, or close animation timing.
- Do not add localization strings, network requests, dependencies, or routing
  interception outside the logo click.

## Verification

- `pnpm --filter @forge/web exec vitest run src/components/__tests__/FloatingSearchProvider.test.tsx`
- `pnpm --filter @forge/web typecheck`
- `pnpm --filter @forge/web lint`
- `pnpm --filter roadmap generate:readme`
- Browser smoke an open search modal, click the logo, and prove the modal closes
  while the current URL and browser navigation entry count remain unchanged.

## Completion Evidence

- Added a modal-aware logo click handler that prevents link navigation while
  search is open or closing, routes the active close through the existing
  provider reset boundary, and labels the logo action as “Close search”.
- Added focused regression coverage proving the click is canceled and the
  overlay completes its close animation; all 81
  `FloatingSearchProvider.test.tsx` tests pass.
- Web typecheck and lint pass.
- Live browser proof on
  `http://127.0.0.1:3130/watch/jesus.html/english.html` confirmed the search
  dialog closed, the route stayed unchanged, the underlying page remained
  mounted, and the browser emitted zero navigation events.
