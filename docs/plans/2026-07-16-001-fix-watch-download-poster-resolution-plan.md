---
title: "fix: sharpen Watch download modal poster"
type: fix
status: completed
date: 2026-07-16
---

# fix: sharpen Watch download modal poster

## Summary

The Watch download modal stretched a `120x68` editorial derivative across a full-width, high-density mobile viewport even when the selected Dub had a Mux playback ID available. Provide this modal with a surface-specific high-resolution still while preserving its current layout and download behavior.

## Problem Frame

`apps/web/src/components/watch/DownloadModal.tsx` renders its poster at nearly the full mobile viewport width. The shared `resolvePosterUrl` helper prioritizes editorial images before Mux; on the reported page that selected a Cloudflare delivery URL fixed at `120x68`, which Next/Image then enlarged for the mobile modal. The fix improves the source asset rather than masking the problem with CSS filters or changing the lightweight thumbnail contract used by cards.

## Requirements

- R1. The download modal uses a poster source sized for its full-width mobile presentation and high-density screens.
- R2. The modal retains a deterministic fallback when the selected Dub lacks a usable Mux playback ID.
- R3. Existing Watch poster resolution for the hero, cards, sibling carousel, and Share modal remains unchanged.
- R4. Download selection, account gating, Terms of Use, duration badge, close controls, and responsive layout remain unchanged.
- R5. Regression coverage locks the modal-specific image resolution behavior, and mobile browser proof confirms the poster is visibly sharp.

## Key Technical Decisions

- **Use a modal-specific resolver.** Keep `resolveMuxFrameThumbnailUrl` at `448x252` for card-sized surfaces and introduce a download-poster path that requests enough source pixels for a roughly 390 CSS-pixel viewport at 3x density.
- **Prefer the selected Dub's high-resolution Mux frame for this surface.** It supplies a sharp frame for the playable media even when the editorial rendition is undersized. When Mux is unavailable, request a larger derivative from dimensioned Cloudflare editorial URLs and leave other providers unchanged.
- **Keep Next Image responsive sizing.** The current `fill`, `sizes`, and `object-cover` layout is correct; the defect is the intrinsic source resolution, not the rendered box.

## Scope Boundaries

- Do not increase the shared chapter/search card thumbnail size or its network cost.
- Do not change Admin GraphQL schema, image ingestion, download APIs, or account-gate behavior.
- Do not add artificial sharpening, blur placeholders, or a new client-side image loader.

## Implementation Units

### U1. Add a high-resolution download-poster resolver

- **Goal:** Resolve a high-density still for the download modal without changing existing card and hero helpers.
- **Requirements:** R1, R2, R3
- **Dependencies:** None
- **Files:** `apps/web/src/lib/url.ts`, `apps/web/src/lib/url.test.ts`
- **Approach:** Add a narrowly named helper that trims and encodes the selected Dub's playback ID, requests a 16:9 Mux frame large enough for the mobile modal, and upgrades dimensioned Cloudflare editorial derivatives when Mux is absent.
- **Patterns to follow:** `resolveMuxFrameThumbnailUrl`, `resolveMuxHeroPosterUrl`, and the null-safe poster priority chain in `apps/web/src/lib/url.ts`.
- **Test scenarios:**
  - A playback ID with whitespace and reserved characters produces the expected encoded high-resolution Mux URL.
  - A blank or missing playback ID upgrades a dimensioned Cloudflare editorial poster and preserves other providers.
  - Missing Mux and editorial inputs return `null`.
- **Verification:** The helper has deterministic URL and fallback tests, while the existing `448x252` helper output remains unchanged.

### U2. Wire and prove the modal-specific poster

- **Goal:** Supply the download modal with the new high-resolution source and prevent regression.
- **Requirements:** R1, R3, R4, R5
- **Dependencies:** U1
- **Files:** `apps/web/src/components/watch/WatchPageClient.tsx`, `apps/web/src/components/watch/DownloadModal.tsx`, `apps/web/src/components/watch/__tests__/WatchPageClient.download.test.tsx`, `apps/web/src/components/watch/__tests__/DownloadModal.test.tsx`, `docs/roadmap/platform/feat-264-watch-download-poster-resolution.md`
- **Approach:** Derive a download-only poster URL beside the existing shared poster URL, pass it only to `DownloadModal`, and retain the current Next Image layout contract. Create the required in-progress roadmap ticket before code changes and mark it complete after validation.
- **Patterns to follow:** Existing modal prop capture in `WatchPageClient.download.test.tsx`, header metadata assertions in `DownloadModal.test.tsx`, and `docs/roadmap/topic-experiences/feat-146-watch-download-modal-mobile-close.md` for scoped modal presentation tickets.
- **Test scenarios:**
  - A selected Dub with Mux playback passes the high-resolution URL to `DownloadModal` while Share modal keeps the existing poster URL.
  - A selected Dub without Mux playback passes the editorial fallback to `DownloadModal`.
  - The rendered poster keeps its `fill`, responsive `sizes`, aspect ratio, duration overlay, and accessible alt text.
- **Verification:** Focused unit tests and web typecheck pass; a mobile-width browser smoke on the affected Watch route captures a screenshot showing a sharp poster without modal regressions.

## Risks & Dependencies

- A larger source increases poster bytes when the modal opens. Scope the request to the lazy-loaded download modal and use a bounded width rather than an uncapped original.
- Browser proof on `/watch/new-believer-course.html/1-the-simple-gospel/english.html` confirmed the old modal source was the `120x68` editorial rendition. The fixed modal requests the selected Dub's `1280x720` Mux frame, selects the `828w` responsive candidate at a 390px viewport, preserves the modal layout, and reports no browser console errors.
