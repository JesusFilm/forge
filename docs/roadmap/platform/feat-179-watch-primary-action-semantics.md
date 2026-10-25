---
id: "feat-179"
title: "Watch primary action semantics"
owner: "vlad"
priority: "P1"
status: "complete"
start_date: "2026-06-11"
duration: 1
depends_on:
  - "feat-178"
blocks: []
tags:
  - "platform"
  - "web"
  - "watch-page"
  - "accessibility"
  - "seo"
---

## Problem

The Watch video page server-renders the visible primary actions, but page
extraction for pages like
`https://watch.jesusfilm.org/watch/jesus-is-brought-to-pilate.html/english.html`
surfaces `Watch now`, `Download`, and `Share` as plain text instead of durable
semantic action targets. The raw HTML contains buttons, but the current shape
still leaves the core actions brittle for keyboard focus, screen readers,
no-JS fallback, SEO extraction, and automated QA.

## Entry Points - Read These First

1. `docs/plans/2026-06-11-003-fix-watch-primary-action-semantics-plan.md` -
   implementation plan for this slice.
2. `apps/web/src/components/watch/HeroPlayer.tsx` - poster-first hero,
   visible Watch now CTA, and transparent click surface.
3. `apps/web/src/components/watch/DownloadButton.tsx` - primary Download CTA.
4. `apps/web/src/components/watch/WatchPageClient.tsx` - selected variant,
   downloads, share URL, and modal orchestration.
5. `apps/web/src/components/watch/BibleQuotesSection.tsx` - section Share CTA.
6. `apps/web/src/components/watch/DownloadModal.tsx` and
   `apps/web/src/app/api/download/route.ts` - concrete download workflow and
   same-origin proxy.

## Grep These

- `hero-player-unmute-pill`
- `hero-player-pre-reveal-click-surface`
- `watch-download-button`
- `watch-share-button`
- `buildDownloadProxyUrl`
- `buildFbShareUrl`
- `WATCH_PILL_BUTTON_CLASS`

## What To Build

1. Make the visible `Watch now` CTA the reliable semantic control for player
   activation, with an accessible name, keyboard activation, and visible focus.
2. Keep the transparent hero click surface pointer-only so keyboard users do
   not land on an invisible duplicate control.
3. Give the primary Download CTA a concrete same-origin download proxy href
   based on the selected variant and default tier, while preserving the JS
   modal, account gate, and Terms of Use flow on normal clicks.
4. Give the primary Share CTA a concrete public share-target href while
   preserving the JS Share modal on normal clicks.
5. Add focused tests that assert tag names, hrefs, accessible names, focus
   classes, click interception, and existing callback behavior.

## Constraints

- Do not expose raw CDN download URLs in the client.
- Do not bypass the existing JS download modal or account-gate behavior for
  normal hydrated clicks.
- Do not load the full DownloadModal or ShareModal chunks on the initial page
  path.
- Do not change public watch URL, canonical URL, Open Graph, or Twitter URL
  ownership.
- Keep the Watch page visually unchanged except for visible focus states.

## Verification

- `pnpm --filter @forge/web test -- src/components/watch/__tests__/HeroPlayer.test.tsx src/components/watch/__tests__/WatchBody.test.tsx src/components/watch/__tests__/BibleQuotesSection.test.tsx src/components/watch/__tests__/DownloadModal.test.tsx`
- `pnpm --filter @forge/web typecheck`
- `pnpm --filter @forge/web lint`
- Helium smoke on a local Watch page confirms `Watch now`, `Download`, and
  `Share` expose semantic controls, retain hydrated behavior, and show visible
  keyboard focus.
