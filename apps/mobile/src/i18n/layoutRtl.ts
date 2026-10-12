import { I18nManager } from "react-native"

// feat-694 KTD8: the one source for the layout direction in use. It is fixed
// for the life of a JavaScript runtime, because a direction change reloads.

/** True when the layout in use reads right-to-left. */
export function isLayoutRtl(): boolean {
  return I18nManager.getConstants().isRTL
}

/** 1 in a left-to-right layout, -1 in a right-to-left one: it multiplies
 *  horizontal gesture and scroll math so the reading direction comes first. */
export function layoutSign(): 1 | -1 {
  return isLayoutRtl() ? -1 : 1
}

/** Side padding that keeps each safe-area inset on its own physical side.
 *  React Native reads `paddingLeft` as the start side, which is the right side
 *  in a right-to-left layout, so the two insets change places there. */
export function insetPadding(insets: { left: number; right: number }): {
  paddingLeft: number
  paddingRight: number
} {
  const rtl = isLayoutRtl()
  return {
    paddingLeft: rtl ? insets.right : insets.left,
    paddingRight: rtl ? insets.left : insets.right,
  }
}

const MIRRORED_ICONS = {
  "chevron-back": "chevron-forward",
  "chevron-forward": "chevron-back",
  "arrow-back": "arrow-forward",
  "arrow-forward": "arrow-back",
} as const

/** An Ionicons name that points back or forward in the reading direction.
 *  Playback icons such as `play-back` are not directional (R12). */
export type DirectionalIconName = keyof typeof MIRRORED_ICONS

/** KTD8: the icon that points `name` in the layout's reading direction. */
export function directionalIcon(
  name: DirectionalIconName,
): DirectionalIconName {
  return isLayoutRtl() ? MIRRORED_ICONS[name] : name
}
