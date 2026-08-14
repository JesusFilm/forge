// Pure presentation selector for the one player (KTD2). No react-native, no
// router import — the caller passes expo-router's segments straight in.

import { isSheetRoute } from "./suppression"

/** What the session store publishes that this selector needs. */
export type MiniPlayerSessionView = {
  videoId?: string
  videoSlug?: string
}

/**
 * Which surface hosts the player right now.
 *
 * - `full`     the full-screen watch view owns it
 * - `floating` the draggable mini window owns it
 * - `hidden`   a session is live and playing, but no surface is mounted
 * - `none`     there is no session at all
 *
 * `hidden` is NOT `none`: playback continues, only the surface goes away.
 */
export type MiniPlayerPresentation = "full" | "floating" | "hidden" | "none"

/**
 * Does the mini player window mount a video view in this presentation?
 *
 * ONE definition, read by the window's render gate AND by the host when it
 * publishes `surfaceFree`. Two hand-kept enumerations is how the published
 * signal drifts into a restatement of "a route claimed the player".
 */
export function windowHoldsSurface(
  presentation: MiniPlayerPresentation,
): boolean {
  return presentation === "floating" || presentation === "hidden"
}

export type PresentationOptions = {
  /** Open non-route sheets (R11's two modal components that own no route). */
  sheetCount?: number
  /** The OS picture-in-picture window is showing (KTD16). */
  pipActive?: boolean
}

/** The root-stack group that renders the full-screen player. */
const WATCH_GROUP = "watch"

/**
 * `segments[0] === "watch"` is the route GROUP, not the Discover tab — that one
 * is `["(tabs)", "watch"]`. Keying on the last segment alone would return
 * `full` for Discover and the window would never appear there.
 */
function isWatchRoute(segments: readonly string[]): boolean {
  return segments[0] === WATCH_GROUP
}

export function presentationFor(
  session: MiniPlayerSessionView | null,
  segments: readonly string[],
  options: PresentationOptions = {},
): MiniPlayerPresentation {
  if (session == null) return "none"

  // R11 is explicit that suppression never applies to the full-screen view, so
  // this precedes both suppression checks. It also keeps R24: unmounting the
  // full view is the handoff picture-in-picture must not see.
  if (isWatchRoute(segments)) return "full"

  if (options.pipActive === true) return "hidden"
  if ((options.sheetCount ?? 0) > 0) return "hidden"
  // Only the series sheets reach here — the watch group already returned full,
  // which is R11's "suppression never applies to the full-screen view".
  if (isSheetRoute(segments)) return "hidden"

  return "floating"
}
