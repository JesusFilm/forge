import type { CalculateMetadataFunction } from "remotion"

import { DEVOTIONAL_FPS, type DevotionalInputProps } from "./schema"
import {
  CARD_TAIL_FRAMES,
  INTRO_HOLD_FRAMES,
  OUTRO_HOLD_FRAMES,
} from "./timing"

// Option A (per-card audio): total = sum of each card's snippet + a small tail
// pad per card. Otherwise (single narration): the audio length + 1s tail.
export const calculateDevotionalMetadata: CalculateMetadataFunction<
  DevotionalInputProps
> = ({ props }) => {
  const perCard =
    props.cards.length > 0 &&
    props.cards.every((c) => typeof c.durationSec === "number")
  const outroSec =
    props.outroHoldSec != null
      ? props.outroHoldSec
      : OUTRO_HOLD_FRAMES / DEVOTIONAL_FPS
  // Must match the per-card layout in DevotionalVideo (framesFromDurations),
  // which honors the introHoldSec override — otherwise the canvas is longer
  // than the cards and the tail renders black.
  const introSec =
    props.introHoldSec != null
      ? props.introHoldSec
      : INTRO_HOLD_FRAMES / DEVOTIONAL_FPS
  const totalSec = perCard
    ? props.cards.reduce(
        (sum, c) =>
          sum +
          (c.durationSec ?? 0) +
          (c.holdSec ?? 0) +
          CARD_TAIL_FRAMES / DEVOTIONAL_FPS,
        0,
      ) +
      introSec +
      outroSec
    : props.audioDurationSec + 1
  return {
    durationInFrames: Math.max(1, Math.round(totalSec * DEVOTIONAL_FPS)),
    fps: DEVOTIONAL_FPS,
  }
}
