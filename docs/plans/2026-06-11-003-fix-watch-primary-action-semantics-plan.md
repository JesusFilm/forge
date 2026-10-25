---
title: "fix: Watch Primary Action Semantics"
type: "fix"
status: "complete"
date: "2026-06-11"
roadmap: "docs/roadmap/platform/feat-179-watch-primary-action-semantics.md"
---

# fix: Watch Primary Action Semantics

## Summary

Make the Watch page's core actions durable semantic controls. `Watch now`
should be the visible player-activation control with keyboard and focus
support. `Download` and `Share` should keep their rich hydrated modals while
also exposing concrete href fallbacks that extraction, no-JS users, and
automated QA can see.

## Problem Frame

The live page at
`https://watch.jesusfilm.org/watch/jesus-is-brought-to-pilate.html/english.html`
currently renders visible text for `Watch now`, `Download`, and `Share`, but
page extraction treats those labels as plain text rather than navigable action
targets. Raw HTML confirms the labels are present, but the current structure is
not resilient enough:

- `Watch now` has both an invisible full-surface button and a visible pill
  button; the invisible surface has no visible focus.
- `Download` is a hydrated JS button with no concrete href fallback, even
  though the same-origin download proxy supports opaque IDs.
- `Share` is a hydrated JS button with no concrete public share target, even
  though the modal already builds Facebook and X targets.

## Requirements

- R1. The visible `Watch now` control has an accessible name that includes the
  visible label, activates the video player with mouse and keyboard, and shows
  a visible focus state.
- R2. Keyboard focus does not land on an invisible duplicate hero click target.
- R3. `Download` exposes a concrete same-origin download proxy href using
  opaque `downloadId`, `variantId`, and `videoSlug` parameters.
- R4. Hydrated Download clicks continue to open the existing gated modal rather
  than bypassing Terms of Use or account checks.
- R5. `Share` exposes a concrete public share-target href derived from the
  current video URL and language slug.
- R6. Hydrated Share clicks continue to open the existing Share modal.
- R7. The modal chunks remain dynamically loaded and out of the initial page
  bundle.

## Key Decisions

- KTD1. Use an anchor for visible fallback-capable primary actions where a
  meaningful URL exists. The hydrated click handler prevents default navigation
  and preserves the richer modal/player behavior; no-JS gets the href.
- KTD2. Keep the transparent hero surface pointer-only. It is useful for mouse
  users tapping the poster, but the visible CTA should be the keyboard and
  assistive-technology target.
- KTD3. Use the existing download proxy's opaque ID path for fallback Download
  links. Raw CDN URLs stay server-only, matching the completed download gate
  design.
- KTD4. Factor only tiny shared helpers for download option selection and proxy
  URL construction so `WatchPageClient` does not statically import the full
  DownloadModal chunk.
- KTD5. Use the existing public share-origin logic for the Share fallback so
  local/non-public origins do not become public crawler targets.

## Scope Boundaries

- In scope: Watch video pages rendered by `apps/web/src/components/watch/*`.
- In scope: primary `Watch now`, `Download`, and Bible Quotes header `Share`
  actions.
- Out of scope: redesigning the download modal, changing social share copy,
  adding new share providers, or changing canonical/public URL ownership.
- Out of scope: generated GraphQL artifacts or admin schema changes.

## Implementation Units

### U1. Hero Watch Now Semantic Control

- **Goal:** Make the visible Watch CTA the reliable semantic control and remove
  the invisible duplicate from keyboard order.
- **Requirements:** R1, R2.
- **Files:** `apps/web/src/components/watch/HeroPlayer.tsx`,
  `apps/web/src/components/watch/__tests__/HeroPlayer.test.tsx`.
- **Approach:** Add a stable player wrapper/control id, render the visible
  `Watch now` pill as an anchor with a Mux stream fallback href when available,
  intercept hydrated clicks to run the existing activation path, add Space-key
  support, and add visible focus classes. Set the transparent poster surface to
  pointer-only with `tabIndex={-1}` and `aria-hidden`.
- **Test scenarios:**
  - The visible CTA is an anchor with `href`, `aria-label`, `aria-controls`,
    and visible focus classes.
  - Clicking the visible CTA prevents navigation and preserves the existing
    activation/play path.
  - The transparent surface is not keyboard focusable.

### U2. Download Fallback Link Without Modal Bundle Regression

- **Goal:** Expose a concrete fallback download URL while keeping hydrated
  modal behavior.
- **Requirements:** R3, R4, R7.
- **Files:** `apps/web/src/components/watch/DownloadButton.tsx`,
  `apps/web/src/components/watch/WatchBody.tsx`,
  `apps/web/src/components/watch/WatchPageClient.tsx`,
  `apps/web/src/components/watch/DownloadModal.tsx`,
  `apps/web/src/components/watch/download-link.ts`,
  `apps/web/src/components/watch/download-options.ts`,
  `apps/web/src/components/watch/__tests__/WatchBody.test.tsx`,
  `apps/web/src/components/watch/__tests__/DownloadModal.test.tsx`.
- **Approach:** Move small download option sorting and proxy URL helpers into
  standalone client-safe modules. Use them in `WatchPageClient` to compute a
  default-tier proxy href from selected variant data and in `DownloadModal` to
  preserve the existing tier behavior. Render `DownloadButton` as an anchor
  when `href` is available; prevent default and call `openDownload` on
  hydrated clicks.
- **Test scenarios:**
  - DownloadButton without `href` remains a button for non-downloadable or
    test harness paths.
  - DownloadButton with `href` renders an anchor, has the accessible label,
    prevents default, and calls the supplied click handler.
  - WatchBody passes the fallback href through when downloads exist.
  - DownloadModal still builds proxy URLs with filename, `downloadId`,
    `variantId`, and `videoSlug`.

### U3. Share Fallback Target

- **Goal:** Expose a public share target while preserving the existing Share
  modal.
- **Requirements:** R5, R6, R7.
- **Files:** `apps/web/src/components/watch/BibleQuotesSection.tsx`,
  `apps/web/src/components/watch/WatchPageClient.tsx`,
  `apps/web/src/components/watch/WatchSectionRenderer.tsx`,
  `apps/web/src/components/watch/__tests__/BibleQuotesSection.test.tsx`.
- **Approach:** Compute a Facebook share fallback href from the current public
  watch path and canonical/shareable origin rules. Thread the href through the
  renderer into `BibleQuotesSection`. Render the Share CTA as an anchor when
  the href is present and intercept hydrated clicks to open the Share modal.
- **Test scenarios:**
  - Share CTA renders as an anchor with a public share href when provided.
  - Hydrated Share clicks prevent default and call the existing modal opener.
  - Existing button behavior remains available when no href is supplied.

## Verification

- Run focused Watch component tests:
  `pnpm --filter @forge/web test -- src/components/watch/__tests__/HeroPlayer.test.tsx src/components/watch/__tests__/WatchBody.test.tsx src/components/watch/__tests__/BibleQuotesSection.test.tsx src/components/watch/__tests__/DownloadModal.test.tsx`.
- Run `pnpm --filter @forge/web typecheck`.
- Run `pnpm --filter @forge/web lint`.
- Launch `apps/web` locally and run a Helium smoke against a Watch page to
  verify exposed controls, hydrated modal/player behavior, and focus states.
