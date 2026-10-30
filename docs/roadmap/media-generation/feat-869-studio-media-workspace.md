---
id: "feat-869"
title: "Implement Media and Preview editor workspaces"
owner: "tataihono"
priority: "P1"
status: "complete"
start_date: "2026-10-21"
duration: 2
depends_on: []
blocks: []
tags: [manager, studio, ui]
---

## Problem

The accepted feat-867/792 Full browser study replaces the Add content modal with
Media/Preview tabs before undo/redo. Browsing must keep the timeline available,
with clip-shaped dragging and linked footage audio, without meaningless counts.

## Entry Points

- `apps/manager/src/features/video-studio/editor.tsx`, `editor-header.tsx`:
  workspace selection, lazy library and existing preview/inspector.
- `library.tsx`: search, source capture, retained assets, uploads, packs and custom
  components. Preserve these authenticated flows and exact source selection.
- `timeline.tsx`, `timeline-layout.ts`: frame scale, lanes and linked source audio.
- `editor-session.ts`: one undoable edit per successful insertion.

## What To Build

Two workspace tabs; full browser replaces preview and inspector, timeline remains.
Keep browsing state across switches and pause playback when entering Media.
Allow dragging footage, image/audio assets and text into appropriate tracks with
a clip-shaped native drag image and timeline placement preview. Capture footage
only on a valid drop, insert at the chosen frame through the current session,
and preserve undo/redo, autosave, publication/read-only checks and errors.
Keep source trimming, subtitles/download choice, uploads, packs and custom UI.

## Constraints

No production deployment, generated GraphQL edits, auth changes, sample content
or fake media. Default to Preview and defer browser requests until Media opens.

## Verification

Focused integration tests for source/asset insertion, cancellation, stale async
completion/read-only checks and tab persistence. Manager typecheck, targeted lint
and formatting; remote browser smoke plus resource timing across Media mount.

## Result

Implemented the full browser in the real Manager editor. Media/Preview tabs are
before undo/redo; the library replaces preview/inspector while the timeline stays
visible and resizable. Entering Media pauses playback. Library search, selected
range and category survive tab switches. Preview is the initial workspace, and
the library chunk and requests remain deferred until user intent. Source ranges,
subtitle/download choice, uploads, packs and custom components retain existing
authenticated operations. Catalog stills are signed server-side from admitted
search results; no playback admission is granted by artwork.

Native drag images use clip styling, source names and linked video/audio. Track
entry shows frame-scaled placement; a valid drop alone captures footage. Insert
uses the current document and chosen frame/track through one session edit. Asset
audio uses recorded duration where available; unknown durations and still images
default to five seconds. Cancellation creates no capture or history. Failed and
late/unmounted captures do not insert. Names from browser selection remain in
editor-local presentation state; canonical asset references stay unchanged.

Validation: 30 focused tests across media workspace, loading shell, timeline
layout, editor session/autosave and artwork passed; touched-scope ESLint and
format checks passed. Manager typecheck reports six pre-existing PNG/string vs
StaticImageData errors in `features/coverage/LanguageGeoSelector.tsx`, with no
errors in this scope. No production deployment performed.

Chrome tested actual Library/Header/Timeline/Session components with isolated
fixture transport: native video drop with linked audio, audio-only drop, undo,
outside cancellation and category changes pass. The narrow editor retains its
existing 720px minimum; desktop at 1100px has no window overflow. Resource timing
in this fixture: library absent before intent; navigation load 1375.9ms, deferred
library chunk starts 2462.8ms after selecting Media; mount-window CLS 0. These
are component-fixture checks, not a production latency claim. Initial loading
shell tests independently prove no library/media calls before data or intent.

Restored the existing remote preview after a missing dev-cache manifest. Font
HTTP 200 and HMR WebSocket open. The real project requires the user's choice of
Google account; no project content was changed for verification. Temporary public
fixture files were removed after browser checks.

## Preview recovery (2026-10-21)

The remote login redirect reproduces HTTP 500: Next route modules attempt to read
`.next/dev/required-server-files.json`, a production-only manifest. Repair the
local preview launcher and verify redirected page requests, not only the initial
307, font or HMR. Preserve the current tunnel origin and normal authentication.

Recovery: replaced the ad hoc programmatic Next launcher in `/tmp` with the
standard `next dev` CLI and regenerated its local dev cache. Config now admits
the configured `MANAGER_BASE_URL` hostname for development resources only, keeping
font/HMR requests working through the existing tunnel. No production setting or
authentication behavior changed. Full redirected requests went from HTTP 500 to
HTTP 200 repeatedly (warm chain 2.46s); browser shows the normal Auth sign-in page.
Font HTTP 200 and HMR WebSocket open. ESLint, formatting and diff checks pass.
Authenticated editor verification remains pending user sign-in. Missing manifest
was a symptom of dev requests taking the production manifest path, not evidence
that a running production build or another task deleted files.
