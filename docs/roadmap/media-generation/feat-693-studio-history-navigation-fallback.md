---
id: "feat-693"
title: "Studio history navigation protection without Navigation API"
owner: "tataihono"
priority: "P2"
status: "not-started"
start_date: "2026-10-13"
duration: 2
depends_on: ["feat-692"]
blocks: []
tags: [manager, studio]
---

## Problem

The feat-692 guard cancels same-document Back/Forward through the Navigation API.
Browsers without cancelable traversal events retain link/unload warnings and local
recovery, but their App Router history traversal has no confirmation.

## Entry Points — Read These First

1. `apps/manager/src/features/video-studio/editor-navigation.ts` — current three event guards.
2. `apps/manager/src/features/video-studio/editor.tsx` — mount lifecycle and recovery.
3. `docs/validation/studio-autosave/check.mjs` — real editor navigation tests.

## Grep These

- `guardEditorNavigation|navigationType|beforeunload|studio-recovery`
- `popstate|__NA|pushState|replaceState`

## What To Build

Evaluate a framework-compatible fallback for same-document history traversal
when `window.navigation` is unavailable. Preserve App Router history state,
forward entries, scroll restoration and editor recovery. Validate actual
supported browser versions and avoid adding synthetic history entries on every
mount. Add tests disabling Navigation API support in the fixture.

## Constraints

Do not monkey-patch Next internals, overwrite router state, or silently discard
edits. Keep unloaded/saved editors and external navigation unaffected.

## Verification

Assert canceled Back/Forward retains pending edits; accepted navigation occurs
once; saved history navigation has no warning; repeated mount/unmount does not
pollute history. Compare editor load and lazy preview timing.
