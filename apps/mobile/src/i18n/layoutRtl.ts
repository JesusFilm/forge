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
