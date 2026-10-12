import { I18nManager } from "react-native"

// feat-692 KTD8: the one source for the layout direction in use. It is fixed
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
