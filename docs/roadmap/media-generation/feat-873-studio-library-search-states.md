---
id: "feat-873"
title: "Add Studio library skeletons and empty states"
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

`apps/manager/src/features/video-studio/library.tsx` and `studio.css`: card-shaped
skeleton grid while requests/debounce are pending; clear search-aware empty states
for footage, assets and packs, with a Clear search action. Distinguish errors from
empty results, retain upload access, and respect reduced motion. Preserve existing
lazy loading and request lifecycle.

## Verification

Focused workspace/loading tests, lint/format/diff checks and browser smoke. No
backend or media requests introduced by the placeholders.

## Result

Twelve noninteractive 16:9 skeleton cards match the media grid while debouncing
and searching. Placeholders respect reduced motion and expose one accessible
loading status. Empty states distinguish no matches from an unused library;
search empties show the query and Clear search, which restores browsing and
focuses the input. Shared assets emptiness uses only displayable image/audio
records; upload remains available. Error states do not show empty-result copy.

Seven workspace tests and two existing loading tests pass; the new transition
case covers loading, no matches and clearing. Lint, formatting and diff checks
pass. Browser smoke with actual components/fixture transport confirms twelve
placeholders, query-specific empty text, clearing, and results returning. The
library chunk remains deferred until Media intent; no network request or media
work is created by skeletons. Temporary public fixture removed.
