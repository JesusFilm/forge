---
title: "perf: Compact the default Watch transcript DOM"
type: perf
status: completed
date: 2026-07-17
---

# perf: Compact the default Watch transcript DOM

## Summary

Keep the full transcript readable on first render in one text container with visible cue breaks, then lazy-load the timestamped cue data and interactive renderer only when the viewer expands the transcript. This reduces long-film DOM and serialized client-prop cost while preserving expanded playback behavior.

## Problem Frame

`SubtitleTranscript` previously mounted the complete interactive cue tree by default. An intermediate compact version removed cue boundaries and still serialized every timestamped cue into the client component. Large films therefore either paid thousands of DOM nodes or still received the full interactive data shape before anyone asked for it.

## Requirements

- R1. A ready transcript renders by default in one neutral text container with cue phrases separated by blank lines, no timestamps, and no per-cue interactive elements.
- R2. The collapsed transcript DOM remains effectively constant in element count as cue count grows while preserving every cue's readable text.
- R3. A keyboard-accessible expansion control lazy-loads the interactive renderer and fetches/parses timestamped cue data only after expansion.
- R4. Player time listeners, active-cue highlighting, cue seeking, language selection, and player reveal behavior operate only in the expanded interactive state.
- R5. The server supplies compact display text rather than timestamped cue objects, keeping all readable text in the initial HTML without an initial browser fetch.
- R6. Collapse removes the per-cue controls and player synchronization listeners from the DOM/runtime again.
- R7. Once a viewer has requested interactive cues, the client may retain that parsed cue data for immediate re-expansion without changing the collapsed DOM.

## Key Technical Decisions

- **Use one neutral text container for the compact state:** Join cue text with a blank line and render it as one text node using preserved line breaks. A `<div>` avoids claiming the entire film is one semantic paragraph while still keeping zero per-cue descendants.
- **Narrow the server transcript payload:** Parse the selected VTT on the server as before, but serialize only the formatted compact text and source URL. Timestamp metadata stays out of initial client props.
- **Lazy-load interaction code and data:** Put VTT loading, cue rendering, and player synchronization in a dynamically imported client module. Fetch and parse the VTT only when the disclosure opens; cache parsed cues by source URL only after that explicit interaction.
- **Gate interaction effects with expansion state:** Do not subscribe to `timeupdate` or `seeking` until the cue list is mounted.
- **Reuse existing localized heading copy for the disclosure:** The compact icon control is named by the translated transcript heading and exposes `aria-expanded`, avoiding a new untranslated catalog-wide string for a conventional chevron affordance.

## Implementation Units

### U1. Specify compact and expanded transcript behavior

- **Goal:** Add regression coverage for formatted compact text and the post-click data/code boundary.
- **Requirements:** R1, R2, R3, R5, R6, R7
- **Dependencies:** None
- **Files:** `apps/web/src/components/watch/__tests__/SubtitleTranscript.render.test.tsx`
- **Approach:** Render server-provided compact text containing blank-line cue separators. Assert the compact node has zero descendants, the browser has not fetched VTT data, and the interactive module has not mounted. Expand, resolve the VTT fetch, then assert the timestamped cue list replaces the compact text. Collapse and assert the formatted compact state returns without another fetch on re-expansion.
- **Patterns to follow:** Existing raw React DOM test setup and `act` event dispatch in adjacent Watch component tests.
- **Test scenarios:**
  - Three cues produce one compact text container whose text preserves blank-line cue boundaries and has no descendants.
  - Increasing cue count changes text content but not the compact transcript subtree's element count.
  - The collapsed initial render performs no browser VTT fetch and contains no timestamped cue objects in its server payload contract.
  - The expansion control exposes `aria-expanded=false`, then `true` after activation.
  - Expansion fetches/parses the VTT and mounts one clickable control and timestamp per cue.
  - Collapse removes the cue controls and restores the continuous text.
  - Re-expansion reuses cue data loaded after the first click.
- **Execution note:** Add the failing DOM contract tests before changing the component.
- **Verification:** Focused jsdom tests fail against eager cue rendering and pass after the compact-state implementation.

### U2. Send only formatted compact text on the initial route

- **Goal:** Keep readable transcript text server-rendered without serializing the timestamped cue array to the client.
- **Requirements:** R1, R2, R5
- **Dependencies:** U1
- **Files:** `apps/web/src/lib/subtitle-transcript.ts`, `apps/web/src/lib/watch-transcript.ts`, `apps/web/src/app/[locale]/[htmlLang]/[...rest]/__tests__/page-routing.test.tsx`, `apps/web/src/components/watch/__tests__/SubtitleTranscript.render.test.tsx`
- **Approach:** Replace the initial cue-array contract with a source URL plus formatted compact text. Format cue boundaries once on the server using blank lines; keep the existing cached VTT fetch and parser behavior unchanged.
- **Patterns to follow:** Existing server-only cached transcript loader and pure subtitle helpers.
- **Test scenarios:**
  - Formatting three cues produces text separated by exactly one blank line.
  - Empty cues produce no usable compact transcript.
  - The route passes compact text and source URL, not cue objects, into the client boundary.
- **Verification:** Server and route tests prove readable initial text remains while the serialized interactive cue shape is absent.

### U3. Lazy-load interactive transcript behavior

- **Goal:** Load timestamped cue data, cue controls, and player synchronization only after expansion.
- **Requirements:** R3, R4, R6, R7
- **Dependencies:** U1, U2
- **Files:** `apps/web/src/components/watch/SubtitleTranscript.tsx`, `apps/web/src/components/watch/InteractiveSubtitleTranscript.tsx`, `apps/web/src/components/watch/__tests__/SubtitleTranscript.render.test.tsx`
- **Approach:** Keep the compact disclosure shell and per-source cue cache in `SubtitleTranscript`. On expansion, dynamically import a focused interactive module and call its VTT loader. Once loaded, mount that module's cue renderer, which owns active-cue synchronization and seeking. Collapse aborts pending work and unmounts the interactive tree; explicit re-expansion retries failed sources while successful sources remain cached.
- **Patterns to follow:** User-triggered `next/dynamic` modules in `WatchPageClient` and the existing cue seek/listener behavior.
- **Test scenarios:**
  - Expanded cue activation seeks, unmutes, plays, and reveals the player exactly as before.
  - Player `timeupdate` and `seeking` listeners are absent while collapsed, present while expanded, and removed after collapse.
  - Fetch failure leaves the compact transcript intact and shows the expanded unavailable state.
  - Multiple tracks expose the selector only in expanded mode and fetch the newly selected source.
  - Re-expanding a previously loaded source does not fetch it again.
- **Verification:** Focused tests, typecheck, and lint pass; browser network/DOM proof shows no initial VTT request or cue rows, then a request and timestamped rows only after expansion.

## Scope Boundaries

- No VTT parsing semantics, subtitle filtering, or server cache TTL changes.
- No transcript truncation, pagination, virtualization, search, or current-time auto-scroll.
- No redesign of the player, language picker modal, mobile app, or TV app.

## Risks & Dependencies

- The icon-only disclosure relies on its conventional chevron plus translated accessible name; browser proof must confirm the affordance remains discoverable at mobile and desktop sizes.
- Hiding the selector while collapsed must not reset the selected transcript track.
- Browser-side VTT loading depends on the same cross-origin fetch path already used for client fallback; failures must degrade inside the expanded panel without removing server-rendered compact text.
- Conditional effects must clean up media listeners when the viewer collapses the transcript.

## Outcome

- The collapsed transcript renders all cue text in one neutral text node, with cue phrases separated by blank lines and no per-cue descendants.
- The initial client contract contains only the VTT source URL and server-formatted compact text; timestamps and cue objects are loaded after expansion.
- Parsed interactive cues are cached by VTT source, failed sources retry on deliberate re-expansion, and collapse aborts pending requests without restarting them.
- A 1,147-cue, 2:05:56 film measured 11 transcript subtree elements while collapsed and 4,600 while expanded. The compact node retained all 37,803 characters and 1,146 cue breaks.
- Browser network proof showed the interactive JavaScript chunks and VTT request only after expansion. Native Mobile Safari proof confirmed the compact phrase spacing without timestamps.

## Verification Results

- `pnpm --filter @forge/web test -- src/components/watch/__tests__/SubtitleTranscript.render.test.tsx src/components/watch/__tests__/SubtitleTranscript.test.tsx 'src/app/[locale]/[htmlLang]/[...rest]/__tests__/page-routing.test.tsx'` — 88 tests passed.
- `pnpm --filter @forge/web typecheck` — passed.
- `pnpm --filter @forge/web lint` — passed.
