import type { UiT } from "../../i18n/useT"
import { progressBarState } from "../../lib/watchProgress/thresholds"

/** Fold progress into the card's accessibilityLabel (mobile a11y
 *  convention — a deliberate divergence from web's silent bar). */
export function progressAccessibilityText(
  entry:
    | { positionSeconds: number; durationSeconds: number }
    | null
    | undefined,
  t: UiT<"Watch">,
): string | null {
  const state = progressBarState(entry)
  if (!state.visible) return null
  if (state.completed) return t("watchedAriaLabel")
  return t("percentWatchedAriaLabel", {
    percent: Math.round(state.fillRatio * 100),
  })
}
