---
id: "feat-870"
title: "Polish Studio media tabs and restore artwork"
owner: "tataihono"
priority: "P1"
status: "complete"
start_date: "2026-10-21"
duration: 1
depends_on: []
blocks: []
tags: [manager, studio, ui]
---

## Problem

Remove the repeated Add text card action, ellipsize source titles on one line,
and restore source/retained image artwork in the Media workspace.

## Entry Points

- `apps/manager/src/features/video-studio/library.tsx`: card rendering and request lifecycle.
- `apps/manager/src/features/video-studio/studio.css`: media grid title sizing.
- `apps/manager/src/services/studio-library-artwork.ts`: admitted catalog still URLs.
- `apps/manager/src/app/api/shorts/command/route.ts`: search enrichment.

## Constraints

Preserve drag-to-timeline, authorization and deferred library loading. Avoid
unbounded retained image-byte downloads or media requests before Media intent.

## Verification

Focused library/artwork tests, lint, formatting and remote preview smoke. Record
image URL status and loading behavior; visual smoke alone is insufficient.

## Result

Removed the universal Add text card action and its unused item factory. Grid
titles use one line with overflow ellipsis and retain the full accessible name.
Source images fall back to public Mux thumbnail URLs when signing is unavailable;
private playback still denies unsigned requests. The real catalog URL returned
HTTP 200 after previously failing before URL generation due to missing signing key.

Shared images now request retained bytes through the authenticated, same-origin
`/api/shorts/library-image` POST route. Metadata admission precedes reads; the
existing broker verifies the digest and caps bytes at 16 MiB. Only PNG/JPEG/WebP
are admitted. Two client requests/server reads maximum; IntersectionObserver
defers offscreen cards and blobs are revoked on tab exit/unmount.

Twelve focused tests pass across workspace, loading, artwork, image admission and
image lifecycle tests. Lint/format/diff checks pass. Full typecheck reports only
the six existing LanguageGeoSelector StaticImageData errors (lines 120–155).
Browser check using actual Library/Header components and fixture transport:
320px real catalog thumbnail decoded; long title rendered at 14px high in a
170px card (430px scroll width), no Add text card button, CLS 0. Library chunk
remained absent until Media intent. Real preview sign-in redirect works; no
project data changed. Temporary public fixture removed after inspection.
