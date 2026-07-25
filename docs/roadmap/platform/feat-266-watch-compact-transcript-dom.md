---
id: "feat-266"
title: "Compact Watch transcript DOM"
owner: "vlad"
priority: "P1"
status: "complete"
start_date: "2026-07-17"
duration: 1
depends_on: []
blocks: []
tags:
  - "platform"
  - "web"
  - "watch-page"
  - "performance"
  - "accessibility"
---

## Problem

Watch renders every transcript cue as a list item, button, timestamp, and text
span on first paint. Long films therefore add hundreds or thousands of DOM
elements even when viewers only want to read the transcript, increasing render
and hydration work for an interaction most viewers never use.

## Entry Points - Read These First

1. `docs/plans/2026-07-17-001-perf-watch-compact-transcript-plan.md` - compact and interactive state contracts.
2. `apps/web/src/components/watch/SubtitleTranscript.tsx` - transcript loading, cue rendering, player synchronization, and seek behavior.
3. `apps/web/src/components/watch/__tests__/SubtitleTranscript.render.test.tsx` - server-provided cue and DOM rendering coverage.
4. `apps/web/src/lib/watch-transcript.ts` - server-side initial transcript parsing and cache boundary.
5. `docs/solutions/performance-issues/watch-non-cloudflare-performance-hardening-20260611.md` - established server-parsed transcript path.

## Grep These

- `watch-subtitle-transcript`
- `watch-subtitle-cues`
- `handleSeek`
- `timeupdate`
- `InitialSubtitleTranscript`

## What To Build

1. Render the transcript in one neutral text container by default, preserving cue phrases with blank-line spacing but no timestamps or per-cue elements.
2. Add an explicit transcript expansion control whose accessible label reuses the localized transcript heading.
3. Keep timestamped cue objects out of the initial client payload; server-render only the formatted compact text.
4. Lazy-load the interactive renderer and browser VTT fetch only after expansion.
5. Attach playback-time synchronization only while the interactive transcript is expanded.
6. Preserve transcript language selection, fallback loading, cue seeking, highlighting, and player reveal behavior in the expanded state.

## Constraints

- Keep transcript text visible on the initial page; do not move SEO-readable content behind client-only loading.
- Do not render hidden per-cue controls in the collapsed DOM.
- Do not change VTT parsing, subtitle/audio matching, or server cache behavior.
- Do not truncate or omit transcript text in the compact state.
- Keep expansion keyboard-accessible and expose its state to assistive technology.

## Verification

- `pnpm --filter @forge/web test -- src/components/watch/__tests__/SubtitleTranscript.render.test.tsx src/components/watch/__tests__/SubtitleTranscript.test.tsx`
- `pnpm --filter @forge/web typecheck`
- `pnpm --filter @forge/web lint`
- In a browser, confirm the collapsed transcript has a constant-size element tree, visible cue breaks, no timestamps or cue buttons, and no client VTT request.
- Expand the transcript and confirm the VTT request, timestamps, cue buttons, active highlighting, language selection, seeking, and collapse behavior match the existing interactive display.

## Completion Evidence

- 88 focused transcript and Watch route tests passed, including constant collapsed DOM size, lazy fetch, source caching, request abort, retry, highlighting, and seeking cases.
- Full `@forge/web` typecheck and lint passed.
- On the 1,147-cue English transcript for _The Savior_, the mobile transcript subtree measured 11 elements collapsed and 4,600 expanded. The single collapsed text node retained 37,803 characters and all 1,146 cue boundaries.
- The interactive JavaScript chunks and VTT request were absent initially and appeared only after expansion; collapsing returned the subtree to 11 elements.
- iPhone 16 Pro / iOS 18.2 Safari smoke proof showed readable phrase spacing with no timestamps in the default view.
