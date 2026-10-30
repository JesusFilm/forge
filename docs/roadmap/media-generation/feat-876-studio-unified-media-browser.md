---
id: "feat-876"
title: "Unify Studio media navigation"
owner: "tataihono"
priority: "P1"
status: "complete"
start_date: "2026-10-21"
duration: 1
depends_on: []
blocks: []
tags: [manager, studio, ui]
---

## Scope

`apps/manager/src/features/video-studio/library.tsx`: one Media sidebar entry,
with JFP, Videos, Images and Audio type buttons in that order. Remove the redundant
heading above media types. Preserve catalog capture, asset insertion, skeletons,
empty states and deferred loading; type changes between retained assets reuse the
existing response. Keep content packs and custom components accessible.

## Verification

Workspace integration and deferred-loading tests, lint, formatting and diff checks.
Use request-count assertions to verify initial loading and asset-type switches.

## Result

One Media navigation item now contains JFP, Videos, Images and Audio, with no
heading above these buttons. Catalog capture remains under JFP. Packs and custom
components keep their navigation entries. Video guidance points to the JFP tab.

All ten workspace/deferred-loading tests pass, including the exact navigation
order and heading absence. Request-count checks prove no initial library requests
before Media intent, and no refetch when switching retained media types. Existing
capture/drop/undo and audio insertion checks pass. Lint, formatting and diff
checks pass. No new imports, media transfers or startup effects were added.
