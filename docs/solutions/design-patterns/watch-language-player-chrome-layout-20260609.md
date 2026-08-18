---
title: Watch language picker, player chrome fade, and measured episode rail overlap
date: 2026-06-09
last_updated: 2026-08-18
category: docs/solutions/design-patterns
module: apps/web
problem_type: design_pattern
component: watch-page
severity: medium
related_components:
  - apps/web/src/components/watch/HeroPlayer.tsx
  - apps/web/src/components/watch/__tests__/HeroPlayer.test.tsx
  - apps/web/src/components/watch/HeroPlayerControls.tsx
  - apps/web/src/components/watch/SubtitleOverlay.tsx
  - apps/web/src/components/watch/__tests__/SubtitleOverlay.test.tsx
  - apps/web/src/components/watch/LanguagePickerModal.tsx
  - apps/web/src/components/watch/LanguageCombobox.tsx
  - apps/web/src/components/FloatingSearchProvider.tsx
  - apps/web/src/components/FloatingSearchBar.tsx
  - apps/web/src/lib/watch-player-chrome-events.ts
tags:
  - watch-page
  - language-picker
  - player-chrome
  - tooltip
  - opacity
  - sticky-hero
  - episode-carousel
  - responsive-layout
  - mobile-landscape
  - safe-area
  - flow-layout
  - accessibility
applies_when:
  - You are changing the public watch page language modal, subtitles/audio selectors, hero player chrome, floating header, or episode rail overlap
  - A future refactor makes the I/O switch text, multi-language tooltips, opacity states, or measured body overlap look accidental
  - You need to verify whether a watch hero layout change should be breakpoint-driven or measurement-driven
  - A compact-landscape preview, long localized title, or episode carousel overlaps the floating header or visible viewport
---

# Watch language picker, player chrome fade, and measured episode rail overlap

## Context

This branch intentionally changes several watch-page UX contracts in response
to visual QA on `http://127.0.0.1:3000/watch/jesus.html/russian.html`.

The code may look over-specific because it encodes product decisions from the
review session. Do not simplify these back to generic labels, ordinary hover
tooltips, breakpoint-only layout, or a binary visible/hidden player chrome
model without revalidating the user-facing behavior.

## Load-bearing UX decisions

### 1. Language picker must be usable when the current language is unreadable

Touched files:

- `apps/web/src/components/watch/LanguagePickerModal.tsx`
- `apps/web/src/components/watch/LanguageCombobox.tsx`
- `apps/web/src/components/watch/__tests__/LanguagePickerModal.test.tsx`
- `apps/web/src/components/watch/__tests__/LanguageCombobox.test.tsx`

Intent:

- Every major label/action on the language modal has an icon so users can
  switch language by intuition even when they cannot read the current locale.
- The language and subtitles section icons are intentionally unframed. Earlier
  circular outlines were removed because they read as extra buttons.
- The subtitles on/off switch uses centered `I/O` symbols, not localized
  "on/off" copy. This is deliberate for cross-language recognition.
- The switch is intentionally compact, closer to two circles than a wide pill.
- Dropdown/selector rows are full width in the modal layout.
- Dropdown hover text is not the five-language tooltip. Selectors use a direct
  single-purpose tooltip such as "Choose audio language" or "Subtitles".
- Section hover tooltips appear when hovering the icon, label, or selector
  region, not only the icon.
- Dropdowns must open instantly on click. Avoid delayed hover-triggered open
  behavior.
- While a dropdown is open, outside click and Escape close only the dropdown
  before closing the whole modal.

Reason future agents might regress it:

- The icon wrappers, tooltip hit areas, and dropdown close ordering can look
  like local polish. They are accessibility and internationalization affordances.

### 2. Five-language tooltips are for primary controls, not dropdown selectors

Touched files:

- `apps/web/src/components/watch/LanguagePickerModal.tsx`
- `apps/web/src/components/watch/LanguageCombobox.tsx`

Intent:

- Icon/action hover tooltips use five high-reach languages for intuition:
  English, Chinese, Hindi, Spanish, and Arabic.
- The tooltip content is the translation line only. It should not show a
  separate language-name label beside every translation.
- Dropdown selector hover should not show the five-language label. It should
  stay compact and action-specific.

Reason future agents might regress it:

- Multi-language labels can look verbose, and compact selector tooltips can
  look inconsistent. The split is intentional: global controls need language-
  independent affordance; selectors need direct task clarity.

### 3. Player chrome has three opacity states and a pointer lockout

Touched files:

- `apps/web/src/components/watch/HeroPlayerControls.tsx`
- `apps/web/src/components/watch/HeroPlayer.tsx`
- `apps/web/src/components/FloatingSearchProvider.tsx`
- `apps/web/src/components/FloatingSearchBar.tsx`
- `apps/web/src/lib/watch-player-chrome-events.ts`
- `apps/web/src/components/watch/__tests__/HeroPlayerControls.test.tsx`
- `apps/web/src/components/watch/__tests__/HeroPlayer.test.tsx`
- `apps/web/src/components/__tests__/FloatingSearchProvider.test.tsx`

Intent:

- After sound-on/full-player reveal, chrome starts dimmed at opacity `0.3`.
- For the first 5 seconds, pointer-driven reveals are blocked. Mouse movement
  or pointer enter should not make header/controls opacity `1` during this
  lockout.
- Non-pointer accessibility interactions still reveal immediately: keyboard,
  focus, touch, and click.
- After the 5-second lockout, idle hides the chrome to opacity `0`.
- Moving the mouse over the video wakes the header and controls rail to
  opacity `0.3`, not `1`.
- Hovering the header zone or bottom controls zone brightens to opacity `1`.
- The cursor must not be hidden.
- The video click surface should not force a pointer cursor while hovering the
  video. It uses the default cursor.
- The controls rail must stay hover-bright once the pointer is over the rail.
  Avoid global video pointermove handlers that immediately dim it again.
- Bright chrome idles back to hidden after 4 seconds unless the user is hovering
  controls.

Reason future agents might regress it:

- A binary `visible` boolean looks simpler, but it loses the requested dim
  transition. Preserve `WatchPlayerChromeVisibilityDetail.opacity` and
  `WATCH_PLAYER_CHROME_REVEAL_EVENT`.

### 4. Floating header/search/logo/globe mirror player chrome opacity

Touched files:

- `apps/web/src/components/FloatingSearchProvider.tsx`
- `apps/web/src/components/FloatingSearchBar.tsx`
- `apps/web/src/components/__tests__/FloatingSearchProvider.test.tsx`

Intent:

- The floating search bar, logo, and language globe use the same opacity state
  as the player chrome: `0.3`, `0`, or `1`.
- Header hover requests a player chrome reveal through
  `WATCH_PLAYER_CHROME_REVEAL_EVENT`.
- During dim state, header hover asks the player to brighten but does not locally
  fake the header to opacity `1`; the player remains the source of truth.
- Modals/search overlay can still hide/inert the floating header surfaces.

Reason future agents might regress it:

- The event handshake may look indirect. It prevents header and controls from
  drifting into different opacity states.

### 5. Muted preview hero height and episode rail overlap are state-aware

Touched files:

- `apps/web/src/components/watch/HeroPlayer.tsx`
- `apps/web/src/components/watch/__tests__/HeroPlayer.test.tsx`

Intent:

- The sound-on player and ordinary muted previews use a full-width 16:9 frame
  capped by visible viewport height: `h-[min(100svh,56.25vw)]`.
- The default pre-reveal overlay is a deliberate compact-landscape exception.
  At `max-width: 1023px`, `max-height: 500px`, and landscape orientation, its
  video wrapper uses `h-[100svh]` so the picture consumes the full available
  small viewport. `100svh` is required for visible iOS Safari viewport chrome.
- In that state, the overlay anchor is laid over the video with
  `-mt-[100svh]`, but becomes an auto-height normal-flow flex container with
  `min-h-[100svh]`. The default overlay becomes `relative`, so a long localized
  title increases the anchor and page height instead of escaping beneath the
  floating header. Safe-area-aware top and inline padding preserve header and
  notch clearance without clamping the title.
- Compact-landscape preview/body overlap is forced to `0`. The body and episode
  carousel follow the completed overlay flow box, after at least one full
  viewport of video. If the title needs more space, the carousel moves farther
  down with it.
- This exception is scoped by `defaultPreRevealOverlayInFlow`. Portrait,
  revealed player chrome, autoplay-suppressed previews, and custom overlays
  retain the ordinary frame and zero-height anchor behavior.
- On sound-on reveal, clear any muted-preview body overlap and smooth-scroll to
  the hero top if the user was already scrolled.
- Outside the compact-landscape exception, the episodes/body panel is pulled
  upward only when the measured episode rail plus bottom padding would not fit
  under the muted hero.
- Do not use a plain width breakpoint for the pull-up. A small/narrow viewport
  can already fit the video plus panel with no overlap, while a wider but squat
  viewport may need a modest overlap.
- Current constants:
  - `HERO_PREVIEW_PANEL_BOTTOM_PADDING_PX = 32`
  - `HERO_PREVIEW_BODY_OVERLAP_EXTRA_PX = 50`
  - `HERO_PREVIEW_BODY_OVERLAP_MIN_PX = 160`
  - `HERO_PREVIEW_BODY_OVERLAP_MAX_PX = 288`
- The computed overlap is exposed as `data-preview-overlap-px` for tests and
  browser smoke. In normal roomy viewports and the compact-landscape exception
  it should be `0`; other squat viewports may use a small positive value.

Reason future agents might regress it:

- A static body overlap looked okay on wide screens but made the muted video
  tiny on narrow screens. Measurement remains the default; compact landscape
  instead uses a bounded full-height, auto-growing flow layout.

### 6. Subtitle lift follows owner-supplied chrome visibility

Touched files:

- `apps/web/src/components/watch/HeroPlayer.tsx`
- `apps/web/src/components/watch/SubtitleOverlay.tsx`
- `apps/web/src/components/watch/__tests__/SubtitleOverlay.test.tsx`

Intent:

- Active subtitles are lifted above the timeline and bottom controls whenever
  chrome is dim or bright.
- When chrome reaches its hidden state, subtitles return to the ordinary
  bottom-edge offset instead of remaining raised over the picture.
- `HeroPlayer` owns the latest `HeroPlayerControls.onVisibilityChange` detail
  and passes the visible/hidden boolean to `SubtitleOverlay`.
- `SubtitleOverlay` may still measure the rendered rail height while it is
  visible, but it must not rediscover visibility with its own global DOM query
  and `MutationObserver`. A second visibility channel can lag or disagree with
  the player lifecycle, especially across fullscreen targets.
- Keep the chrome lift independent from the overlay's scroll-aware body-zone
  offset. One avoids player controls; the other avoids content occluding the
  sticky hero.

Browser proof on the Russian Watch route measured a `-64px` transform with
visible chrome and 4 px of clearance above the rail. After auto-hide, the
transform returned to `0px` and the subtitle lower edge sat 16 px above the
player frame bottom.

Reason future agents might regress it:

- Watching `data-visible` locally looks self-contained, but makes a display
  component infer lifecycle state that its owner already knows. Preserve the
  direct state flow and the visible-hidden-visible regression test.

### 7. Language comboboxes must keep their active option visible and mounted

Touched files:

- `apps/web/src/components/watch/LanguageCombobox.tsx`
- `apps/web/src/components/watch/__tests__/LanguageCombobox.test.tsx`

Intent:

- The language search input is an editable ARIA combobox with list
  autocomplete. Its `aria-controls` points to the listbox, and its
  `aria-activedescendant` points to the keyboard-active option.
- Use a per-instance `useId()` prefix for the listbox and option IDs. The same
  option keeps its ID when filtering changes the visible result set.
- Keyboard navigation must keep the active row inside the visible listbox for
  both rendering modes. The virtualization threshold decides whether React
  mounts every row; it does not prove that every mounted row fits inside the
  listbox viewport.
- For a non-virtualized list, update the DOM `listbox.scrollTop` when the active
  row crosses the viewport. All rows are already mounted, so a React scroll
  state update is unnecessary.
- For virtualized lists, keyboard navigation must update the virtual scroll
  state after updating the DOM scroll position. Otherwise the active option can
  be scrolled into view imperatively but remain absent from React's rendered
  window, leaving `aria-activedescendant` dangling.
- In `scrollActiveOptionIntoView`, calculate row positions from the shared
  row-height and listbox-padding constants. Include the listbox's top padding
  in `rowTop`, and remove it again when scrolling upward so the first row
  aligns correctly without producing a negative `scrollTop`.
- Only expose `aria-activedescendant` while its target is mounted. This avoids
  a stale reference when pointer scrolling moves a virtual window away from
  the keyboard-active row.

Reason future agents might regress it:

- An early return below the virtualization threshold looks efficient, but a
  filtered all-mounted list can still be taller than the listbox. Conversely,
  a DOM-only scroll fix looks sufficient visually for a virtualized list, but
  assistive technology follows a DOM ID that React may not have mounted.
  Preserve the regular ARIA relationship test, the virtualized keyboard test,
  and a filtered non-virtualized overflow test that moves down and back up.

## Verification commands

Run the focused tests after touching this surface:

```bash
pnpm --filter @forge/web test -- src/components/watch/__tests__/HeroPlayer.test.tsx src/components/watch/__tests__/HeroPlayerControls.test.tsx src/components/watch/__tests__/SubtitleOverlay.test.tsx src/components/__tests__/FloatingSearchProvider.test.tsx src/components/watch/__tests__/LanguagePickerModal.test.tsx src/components/watch/__tests__/LanguageCombobox.test.tsx
```

Run lint before handing off:

```bash
pnpm --filter @forge/web lint
```

Browser smoke that caught regressions in this branch:

- Local page: `http://127.0.0.1:3000/watch/jesus.html/russian.html`
- Roomy/small viewport expected values:
  - `data-preview-overlap="false"`
  - `data-preview-overlap-px="0"`
  - `marginBottom: 0px`
- Squat non-compact viewport expected values:
  - `data-preview-overlap="true"`
  - positive `data-preview-overlap-px`
  - episode rail bottom padding around 30 px
- Compact-landscape default pre-reveal expected values:
  - wrapper height equals `100svh`
  - `data-preview-overlap="false"`
  - `data-preview-overlap-px="0"`
  - `marginBottom: 0px`
  - body and episode content begin after the complete overlay flow box
  - an oversized localized title stays below the header and grows the anchor
- Sound-on reveal:
  - `data-chrome-revealed="true"`
  - `data-preview-overlap="false"`
  - `marginBottom: 0px`
  - page scrolls back to hero top if it was scrolled
- Preserve boundary smoke at 390x844 portrait and 1024x501 landscape.

Browser proof on 2026-07-17 measured the default Russian route at 844x390 with
a 390 px wrapper and anchor, the body beginning at 390 px, and zero overlap. At
844x220, the anchor grew to 251.8 px for the localized title, retained an 8 px
gap below the 60 px header, and pushed the body to 251.8 px. Portrait kept its
390 px square preview and the compact variant remained inactive at 1024x501.

Related planning records:

- `docs/roadmap/platform/feat-365-watch-language-picker-keyboard-scroll.md`
- `docs/plans/2026-07-16-001-fix-watch-mobile-landscape-hero-layout-plan.md`
- `docs/roadmap/platform/feat-264-watch-mobile-landscape-hero-layout.md`
- `docs/roadmap/platform/feat-175-watch-mobile-portrait-hero-preview.md`
- `docs/solutions/design-patterns/mux-player-custom-react-chrome-pattern-20260430.md`

## Agent guidance

Before changing these files, search for this note and preserve the contracts
above unless the product decision is explicitly changed. If a future screenshot
looks wrong, measure `getBoundingClientRect()` for the hero, body zone, and
`[data-block-type="SiblingCarousel"]` before choosing a new spacing value.
