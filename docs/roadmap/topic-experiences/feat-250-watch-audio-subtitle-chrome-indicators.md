---
id: "feat-250"
title: "Watch Audio and Subtitle Chrome Indicators"
owner: "urim"
priority: "P1"
status: "in-progress"
start_date: "2026-07-13"
duration: 1
depends_on: []
blocks: []
tags:
  - "web"
  - "watch"
  - "ux"
  - "accessibility"
---

## Problem

The Watch player chrome represents the combined language control with a globe
and the audio language code. That icon does not communicate audio clearly, and
the chrome gives no at-a-glance indication that subtitles are available or
that the selected subtitle language differs from the audio language.

## Entry Points - Read These First

1. `apps/web/src/components/watch/HeroPlayerControls.tsx` - in-player language
   button layout, accessibility label, and chrome test IDs.
2. `apps/web/src/components/watch/HeroPlayer.tsx` - audio language-code
   derivation and the props passed into the custom chrome.
3. `apps/web/src/components/watch/WatchPageClient.tsx` - selected subtitle
   state and the active subtitle record.
4. `apps/web/src/components/watch/WatchSectionRenderer.tsx` - prop boundary
   between the page client and `HeroPlayer`.
5. `apps/web/src/components/watch/__tests__/HeroPlayerControls.test.tsx` and
   `apps/web/src/components/watch/__tests__/HeroPlayer.test.tsx` - focused
   player chrome regression coverage.

## Grep These

- `hero-chrome-language|hero-chrome-language-code|Globe` in
  `apps/web/src/components/watch/HeroPlayerControls.tsx`.
- `languageCodeFor|subtitleVttSrc|subtitleSlug` in
  `apps/web/src/components/watch/`.
- `changeAudioLanguage|subtitlesHeading` in `apps/web/messages/en.json`.

## What To Build

1. Replace the in-player globe glyph with an audio/voice glyph while keeping
   the active audio language code and the existing Language & Subtitles modal
   action.
2. Add an adjacent subtitles glyph when the current video exposes subtitle
   options. The glyph opens the same Language & Subtitles modal.
3. When subtitles are enabled and their selected language differs from the
   audio language, render the subtitle language code beside the subtitles
   glyph. Do not duplicate the code when both languages match.
4. Preserve compact responsive chrome spacing, keyboard focus, accessible
   labels, fullscreen behavior, and current subtitle playback behavior.

## Constraints

- Do not change Admin GraphQL, subtitle preference rules, VTT track injection,
  route behavior, or generated artifacts.
- Do not redesign the Language & Subtitles modal.
- Keep the top floating-header language switcher unchanged in this slice.
- Derive language codes with the existing Watch language-code helper.

## Verification

```bash
pnpm --filter @forge/web exec vitest run src/components/watch/__tests__/HeroPlayerControls.test.tsx src/components/watch/__tests__/HeroPlayer.test.tsx
pnpm --filter @forge/web exec tsc --noEmit --pretty false
pnpm --filter @forge/web lint
```

Browser smoke a Watch route with subtitles at desktop and mobile widths:

- audio uses the voice glyph and keeps its language code;
- the subtitles glyph sits beside audio and opens the shared modal;
- matching audio/subtitle languages do not repeat a subtitle code;
- a translated subtitle selection displays its compact language code;
- controls remain within the chrome rail and fullscreen still exposes them.
