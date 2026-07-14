---
title: "feat: Add Watch audio and subtitle chrome indicators"
type: feat
status: completed
date: 2026-07-13
---

# feat: Add Watch audio and subtitle chrome indicators

## Summary

Replace the Watch player's in-chrome globe with an audio/voice indicator and
add an adjacent subtitles indicator. Show the selected subtitle language code
only when active subtitles use a different language from the audio track.

## Problem Frame

The current globe plus language code reads as a generic locale control even
though the displayed code identifies the active audio dub. The same shared
modal already manages audio and subtitles, but the player chrome does not
surface subtitle availability or a cross-language subtitle selection.

## Requirements

- R1. The in-player audio control uses a voice/audio glyph and retains the
  compact active audio language code.
- R2. Videos with subtitle options render an adjacent subtitles control that
  opens the existing Language & Subtitles modal.
- R3. Enabled subtitles render their language code beside the subtitles glyph
  only when that code differs from the audio language code.
- R4. Matching-language subtitles and disabled subtitles do not render a
  redundant subtitle language code.
- R5. The controls preserve keyboard access, localized accessible labels,
  fullscreen availability, responsive rail fit, and existing playback state.

## Assumptions

- The subtitles glyph remains visible whenever subtitle options exist, even
  when subtitles are disabled, so viewers can reach the subtitle controls.
- Both audio and subtitle indicators open the existing combined modal rather
  than introducing separate selection surfaces.
- The floating-header language switcher remains a globe because this request
  targets the player chrome shown in the supplied screenshot.

## Key Technical Decisions

- KTD1. Carry the selected subtitle language identity from the page client
  through the existing renderer boundary; subtitle preference and VTT-track
  ownership stay in `WatchPageClient`.
- KTD2. Derive both compact codes with `languageCodeFor` and compare normalized
  output, avoiding slug comparison and duplicate language-code logic.
- KTD3. Keep both indicators as independent `ChromeButton` targets wired to the
  existing modal callback, preserving focus behavior and tap-target sizing.

## Scope Boundaries

- In scope: custom hero player chrome, selected subtitle display metadata,
  focused component tests, and browser proof at responsive widths.
- Out of scope: the floating header globe, Language & Subtitles modal layout,
  subtitle selection policy, VTT rendering, GraphQL/schema work, and other
  platforms.

## Implementation Units

### U1. Carry active subtitle display metadata to the player chrome

- **Goal:** Make the selected subtitle language code and subtitle availability
  available at the custom chrome without moving subtitle state ownership.
- **Requirements:** R2, R3, R4
- **Dependencies:** None
- **Files:**
  - `apps/web/src/components/watch/WatchPageClient.tsx`
  - `apps/web/src/components/watch/WatchSectionRenderer.tsx`
  - `apps/web/src/components/watch/HeroPlayer.tsx`
  - `apps/web/src/components/watch/__tests__/WatchPageClient.download.test.tsx`
  - `apps/web/src/components/watch/__tests__/HeroPlayer.test.tsx`
- **Approach:** Resolve the active subtitle record from `subtitleEnabled`,
  `subtitleSlug`, and the current subtitle list. Pass subtitle availability and
  the normalized selected code through `WatchSectionRenderer` into
  `HeroPlayerControls`, leaving media-track behavior unchanged.
- **Patterns to follow:** Existing `subtitleVttSrc` prop flow and
  `languageCodeFor` audio-code derivation.
- **Test scenarios:**
  - The page client resolves an enabled translated subtitle to its normalized
    code and carries that value through the renderer boundary.
  - Enabled translated subtitles produce the selected subtitle code at the
    `HeroPlayerControls` boundary.
  - Enabled same-language subtitles produce the same normalized code for the
    chrome to suppress.
  - Disabled subtitles produce no selected subtitle code while subtitle
    availability remains true.
  - A video with no subtitle options reports no subtitle availability.
- **Verification:** Existing subtitle track injection remains unchanged and the
  player receives stable display metadata across subtitle toggles.

### U2. Render distinct audio and subtitle controls

- **Goal:** Replace the globe with a voice/audio glyph and add the conditional
  subtitle indicator with mismatch-only code display.
- **Requirements:** R1, R2, R3, R4, R5
- **Dependencies:** U1
- **Files:**
  - `apps/web/src/components/watch/HeroPlayerControls.tsx`
  - `apps/web/src/components/watch/chrome-icons.tsx`
  - `apps/web/src/components/watch/__tests__/HeroPlayerControls.test.tsx`
- **Approach:** Use the established custom-chrome icon style for audio, reuse
  the existing captions icon language for subtitles, and render two adjacent
  `ChromeButton` targets. Gate the subtitle target on subtitle availability
  independently of the existing multi-audio-language gate. Each target opens
  the combined modal; only the subtitle target conditionally adds a normalized
  mismatched code. Reuse the existing localized subtitles label from the
  `LanguagePickerModal` message namespace instead of adding a duplicate key.
- **Patterns to follow:** Existing `ChromeButton` sizing/focus contract,
  `hero-chrome-language` render gate, and the unframed captions glyph from the
  language picker.
- **Test scenarios:**
  - Audio renders the voice glyph plus audio code and no globe.
  - Available subtitles render an adjacent button; unavailable subtitles do
    not.
  - A single-audio-language video with subtitle options still renders the
    subtitle control even though the audio-language control is gated off.
  - Different active audio/subtitle codes render the subtitle code.
  - Matching codes and absent/disabled subtitle codes suppress the subtitle
    code.
  - Clicking either control invokes the modal callback once.
  - Both controls retain localized accessible labels and full tap targets.
- **Verification:** Focused DOM tests pass and both desktop and narrow mobile
  browser smoke show the controls fitting before fullscreen.

## Risks & Dependencies

- Adding another chrome target can crowd narrow viewports; responsive browser
  proof must include a translated subtitle code because that is the widest
  state.
- Subtitle language metadata may be absent only if upstream normalization is
  broken; the UI must fail closed by omitting the code rather than inventing
  one.

## Sources & Research

- `docs/roadmap/topic-experiences/feat-250-watch-audio-subtitle-chrome-indicators.md`
- `docs/solutions/design-patterns/watch-language-player-chrome-layout-20260609.md`
- `apps/web/src/components/watch/HeroPlayerControls.tsx`
- `apps/web/src/components/watch/WatchPageClient.tsx`
