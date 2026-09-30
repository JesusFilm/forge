import type { CalculateMetadataFunction } from "remotion"

import { DEVOTIONAL_FPS, type DevotionalInputProps } from "./schema"
import {
  CARD_TAIL_FRAMES,
  INTRO_HOLD_FRAMES,
  OUTRO_HOLD_FRAMES,
  framesFromDurations,
} from "./timing"

// Option A (per-card audio): the canvas is exactly the cards as DevotionalVideo
// lays them out (framesFromDurations: each card's snippet, hold and own tail,
// plus the intro and outro holds). Summing seconds here instead once ignored a
// card's `tailSec`, and the canvas ran 24s past the last card in black.
// Otherwise (single narration): the audio length + 1s tail.
export const calculateDevotionalMetadata: CalculateMetadataFunction<
  DevotionalInputProps
> = ({ props }) => {
  const perCard =
    props.cards.length > 0 &&
    props.cards.every((c) => typeof c.durationSec === "number")
  const fps = DEVOTIONAL_FPS
  const outroFrames =
    props.outroHoldSec != null
      ? Math.round(props.outroHoldSec * fps)
      : OUTRO_HOLD_FRAMES
  const introFrames =
    props.introHoldSec != null
      ? Math.round(props.introHoldSec * fps)
      : INTRO_HOLD_FRAMES
  const durationInFrames = perCard
    ? framesFromDurations(
        props.cards,
        fps,
        CARD_TAIL_FRAMES,
        outroFrames,
        introFrames,
      ).reduce((sum, f) => sum + f.durationInFrames, 0)
    : Math.round((props.audioDurationSec + 1) * fps)
  return { durationInFrames: Math.max(1, durationInFrames), fps }
}
