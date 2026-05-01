---
date: 2026-04-30
topic: watch-hero-player-title-overlay
---

# Watch Hero Player — Title & Category Overlay

## Summary

Add a bottom-left overlay inside the watch page's `HeroPlayer` showing the video's category label and title above the existing "Play with Sound" pill. On press, the overlay text disappears alongside the pill, the Mux chrome reveals, and the existing unmute behavior is preserved.

---

## Problem Frame

Today the `HeroPlayer` autoplays muted on a loop with a single bottom-centered "Play with Sound" pill and no contextual labeling — viewers see the visuals but the player carries no signal about what they are about to watch (label, title) without scrolling to the `WatchBody` section below. The reference design treats the muted-loop hero as a poster: a small uppercase category, the title, and a clearly-grouped CTA in the bottom-left corner over a gradient scrim.

---

## Requirements

**Overlay content & layout**

- R1. While `chromeRevealed` is `false`, render an overlay group at the **bottom-left** of the player area containing, top-to-bottom: video label (uppercase, small), video title (large), then the existing Play with Sound pill (left-aligned).
- R2. The overlay sits over a bottom-up gradient scrim sized to keep the text legible against any video frame.
- R3. The label respects the same conditional rendering as `WatchBody` — if `video.label` is absent, omit only the label line; the title and pill still render.
- R4. The title uses `video.title` as already passed to `HeroPlayer` via `block.video`. No new GraphQL fields are needed.

**Pill repositioning**

- R5. Move the Play with Sound / Tap to Unmute pill from its current bottom-center position to bottom-left, grouped immediately below the title.
- R6. Both pill states (`play-with-sound` and `tap-to-unmute`) inherit the new position. Default-state pill becomes red (matches reference); `tap-to-unmute` keeps its existing amber treatment. Icons unchanged.

**Reveal behavior**

- R7. When the user presses Play with Sound, the existing handler runs unchanged (unmute → reset to 0 → play → reveal chrome).
- R8. When `chromeRevealed` is `true`, the entire overlay group (label, title, pill, scrim) is gone and does not re-appear if the user later pauses, scrubs, or finishes playback.
- R9. If autoplay is blocked and the pill swaps to `tap-to-unmute`, the overlay text remains visible until the user successfully unmutes.

**Body section**

- R10. The existing `WatchBody` label + title block remains unchanged — the overlay is additive, not a replacement. Both appear on the page.

**Responsive**

- R11. On narrow viewports the title font scales down so the overlay does not overflow the player; the pill stays left-aligned and full-width-aware.

---

## Acceptance Examples

- AE1. **Covers R1, R2, R5.** Given the watch page has loaded and the player is autoplaying muted, when the user looks at the player, then a bottom-left overlay shows "SHORTFILM" in small uppercase, "Considering Christmas" in large type, and a red "Play with Sound" pill below — all sitting over a bottom-up dark gradient.
- AE2. **Covers R7, R8.** Given the overlay is visible, when the user clicks Play with Sound, then the video unmutes, restarts from 0, the overlay (label, title, pill, scrim) is removed, and Mux's native chrome appears.
- AE3. **Covers R9.** Given autoplay was blocked and the pill is in `tap-to-unmute` state, when the user is looking at the player, then the title and label overlay are still visible alongside the amber `Tap to Unmute` pill in the bottom-left.
- AE4. **Covers R3.** Given a video has no `label` value, when the page loads, then the overlay shows only the title and pill (no label line, no empty placeholder).
- AE5. **Covers R10.** Given the overlay shows "SHORTFILM / Considering Christmas" inside the player, when the user looks below the player, then the existing `WatchBody` "SHORT FILM / Considering Christmas / description" block is still rendered.

---

## Success Criteria

- A first-time visitor can identify the video's category and title without scrolling, while the muted loop is still playing.
- The press-to-unmute interaction feels unchanged — the existing user-activation path, autoplay-blocked fallback, and Mux chrome reveal all behave exactly as today.
- A downstream implementer can build this without re-querying the user about position, gradient, conditional rendering, or duplicate-with-WatchBody intent.

---

## Scope Boundaries

- No changes to `WatchBody`, `SiblingCarousel`, `BibleQuotesSection`, `AskYoursPanel`, or `WatchSectionRenderer`.
- No changes to GraphQL operations, `WatchVideoFragment`, or `block.video` shape.
- No changes to the unmute / chrome-reveal logic, autoplay-blocked handling, or Mux Data metadata.
- No new motion/animation work beyond simple opacity transitions in line with the existing pill's transition class.
- No mobile-specific redesign — same overlay layout at every breakpoint, just smaller type on narrow viewports.

---

## Key Decisions

- **Overlay & pill share the `!chromeRevealed` gate.** Once the chrome reveals, the overlay never re-appears — matches the existing pill semantics and keeps the post-reveal viewing experience uncluttered.
- **Title is duplicated between player overlay and `WatchBody`.** The reference design shows both. The overlay is hero-decoration; the body section remains the canonical, scrollable text block (and houses the description and download button).
- **Audio behavior is unchanged.** Press unmutes, restarts, reveals chrome — explicitly confirmed during brainstorming despite "muted chrome" language in the original ask.

---

## Dependencies / Assumptions

- `block.video.label` and `block.video.title` are already projected by `WatchVideoFragment` and reach `HeroPlayer` today (verified against `src/components/watch/HeroPlayer.tsx` and `src/components/watch/WatchBody.tsx`).
- The `MuxPlayer` component continues to render its native chrome at the bottom edge when `CHROME_HIDE_STYLE` is not applied — overlay placement at bottom-left assumes no collision while overlay is visible (chrome is hidden) and no collision after reveal (overlay is gone).

---

## Outstanding Questions

### Deferred to Planning

- [Affects R11][Technical] Exact responsive type-scale ramp for the title — pick during planning to match the existing `WatchBody` title scale (`text-3xl md:text-4xl xl:text-5xl`) or step down for the overlay context.
- [Affects R2][Technical] Gradient scrim dimensions and opacity stops — pick a Tailwind treatment that holds up against bright frames without darkening the video too aggressively.
