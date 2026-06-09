---
date: 2026-06-08
topic: watch-hero-player-cinematic-frame
---

# Watch Hero Player — Cinematic Frame

## Summary

After the viewer commits playback, the watch-page hero player becomes a cinematic black stage. The video remains fully visible at its preserved aspect ratio, centered inside the black parent with responsive padding when the viewport allows.

---

## Problem Frame

The watch hero currently distinguishes muted preview from committed playback, but the committed state still reads as a utilitarian player box. The desired experience is a framed viewing state: the video is not cropped, the black parent gives it room to breathe, and the player feels intentional after Play with Sound.

---

## Requirements

**Committed playback frame**

- R1. When the viewer starts committed playback, animate the black player parent from the preview layout into the framed playback layout.
- R2. In the framed playback layout, the video preserves its aspect ratio and remains fully visible.
- R3. In the framed playback layout, the video is centered horizontally and vertically inside the black parent.
- R4. When viewport space allows, the black parent includes extra top, bottom, and side padding around the video.
- R5. When viewport space is tight, preserving full video visibility takes priority over decorative frame padding.

**Preview and controls**

- R6. The muted preview layout may continue to use the existing cinematic cover/crop treatment.
- R7. Existing player controls, subtitle overlay, language switching, and fullscreen behavior continue to work after the layout transition.

---

## Acceptance Examples

- AE1. **Covers R1, R2, R3.** Given the watch hero is in muted preview, when the viewer clicks Play with Sound, then the black player area animates into a framed playback state and the full video is visible in the center.
- AE2. **Covers R4, R5.** Given a wide viewport with enough room, when committed playback starts, then the black parent leaves visible breathing room around the video. Given a tight viewport, the video remains fully visible even if the frame padding is reduced.
- AE3. **Covers R6.** Given the viewer has not committed playback, when the muted preview loops, then the existing cover/crop preview treatment remains available.
- AE4. **Covers R7.** Given committed playback is active, when the viewer uses controls, subtitles, language switching, or fullscreen, then those behaviors continue to work from the framed layout.

---

## Scope Boundaries

- Do not recreate the provided reference image as a modal, white page, or close-button interaction.
- Do not change playback source selection, Mux backend selection, Mux Data metadata, subtitle source handling, language switching, fullscreen behavior, or download/share behavior.
- Do not redesign the custom chrome beyond keeping it usable and positioned cleanly with the framed player.

---

## Key Decisions

- **Framed contain state is post-commit only.** The preview can keep the current cover treatment because its job is poster-like immersion; committed playback prioritizes full visibility.
- **Black parent frames the video.** The video itself does not need to fill every available pixel. The black parent may be larger than the video to create the centered stage.
- **Padding is responsive, not absolute.** Frame padding should appear when the viewport has room and give way when fitting the video requires it.

---

## Sources / Research

- `apps/web/src/components/watch/HeroPlayer.tsx` already tracks `chromeRevealed` and switches the media object-fit from cover to contain.
- `apps/web/src/components/watch/HeroPlayerControls.tsx` ports custom chrome to the overlay anchor, so the implementation must preserve the committed playback controls path.
- `docs/solutions/design-patterns/mux-player-custom-react-chrome-pattern-20260430.md` documents the sticky hero and custom React chrome constraints.
