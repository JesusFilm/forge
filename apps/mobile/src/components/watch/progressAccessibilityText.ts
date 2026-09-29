import { getT, type UiT } from "../../i18n/useT"
import { progressBarState } from "../../lib/watchProgress/thresholds"

/**
 * Fold progress into the card's accessibilityLabel (mobile a11y
 * convention — a deliberate divergence from web's silent bar).
 */
export function progressAccessibilityText(
  entry:
    | { positionSeconds: number; durationSeconds: number }
    | null
    | undefined,
  // Home and series cards do not pass their `t` yet, so the default reads the
  // catalog in use at the call.
  t: UiT<"Watch"> = getT("Watch"),
): string | null {
  const state = progressBarState(entry)
  if (!state.visible) return null
  if (state.completed) return t("watchedAriaLabel")
  return t("percentWatchedAriaLabel", {
    percent: Math.round(state.fillRatio * 100),
  })
}
