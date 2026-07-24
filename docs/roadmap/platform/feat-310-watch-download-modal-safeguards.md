---
id: "feat-310"
title: "Restore Watch download modal safeguards"
owner: "urim"
priority: "P1"
status: "in-progress"
start_date: "2026-07-24"
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

The single-video Watch download modal no longer requires Terms of Use
confirmation, displays file-size copy that should be removed, and can replace
authored thumbnail artwork with a dark Mux frame. These regressions weaken the
download safeguard and make the modal presentation diverge from the legacy
Watch behavior.

## Entry Points - Read These First

1. `apps/web/src/components/watch/DownloadModal.tsx` - quality picker, modal
   state, account gate, and final download action
2. `apps/web/src/components/watch/__tests__/DownloadModal.test.tsx` - modal
   behavior and interaction coverage
3. `apps/web/src/lib/url.ts` - download-specific poster resolution
4. `apps/web/src/lib/url.test.ts` - poster source priority coverage
5. `apps/web/src/lib/terms-of-use.ts` - retained canonical Terms text and URL
6. `apps/web/src/components/watch/WatchPageClient.tsx` - modal poster and
   download prop wiring

## Grep These

- `resolveDownloadPosterUrl`
- `watch-download-modal-confirm`
- `termsAgreementPrefix`
- `fetchSizeFromProxy`
- `56e60dc2`

## What To Build

1. Prefer authored cinematic artwork for the download modal, upgrade supported
   Cloudflare dimensions, and use a high-resolution Mux frame only as fallback.
2. Restore the localized agreement checkbox and nested Terms dialog.
3. Keep Download disabled until agreement is accepted and reset agreement when
   the modal closes.
4. Remove file sizes from the selected quality and every dropdown option.
5. Remove the modal-open HEAD probes used only to discover display sizes.
6. Preserve current account gating, tier selection, filenames, proxy behavior,
   close controls, and responsive layout.

## Constraints

- Do not change the download route, target lookup, SSRF protections, or range
  behavior.
- Do not change the account-gate rollout behavior.
- Do not change quality bucketing or internal size-based ordering.
- Do not modify poster behavior on other Watch surfaces.
- Reuse the retained Terms constants and localization keys.

## Verification

- Focused resolver, Watch client, and download modal tests.
- `@forge/web` typecheck and lint.
- Desktop and mobile browser smoke of the single-video modal, including nested
  Terms cancel/accept behavior and absence of file-size copy.
- Confirm no size-discovery HEAD requests occur when the modal opens.
