/**
 * The pure presentation selector — the mini player's answer to "which surface
 * hosts this video right now", modelled on `heroPageVideoState` in
 * `watchHome/pagerReducer.ts`, the in-repo precedent for exactly one surface
 * hosting at a time.
 *
 * Route tables below are read from `app/_layout.tsx`, `app/watch/_layout.tsx`,
 * `app/series/_layout.tsx` and `app/(tabs)/_layout.tsx`. They are route
 * PATTERNS, which is what expo-router's segments carry: a route named
 * `[slug]`, group segments kept verbatim ("(tabs)"), and a trailing "index"
 * already popped by the router (`getRouteInfoFromState`), so the Home tab is
 * "(tabs)" and not "(tabs)/index".
 */

import type { MiniPlayerStoreSnapshot } from "./store"
import { isSuppressedBySheet, routePattern } from "./suppression"

export type MiniPlayerPresentation =
  | "full"
  | "floating"
  | "hidden"
  | "exiting"
  | "none"

/**
 * The full-screen video view and the three sheets that sit OVER it. R11's
 * suppression never applies to the full-screen view, which is why the
 * watch-group sheets belong here rather than in the suppressed set.
 *
 * "watch/[slug]" is the player; the Discover tab is "(tabs)/watch". Two
 * different routes whose first segment is the same word.
 */
export const FULL_SCREEN_ROUTE_PATTERNS = [
  "watch/[slug]",
  "watch/language",
  "watch/subtitle",
  "watch/download",
] as const

/** The four tab roots from `app/(tabs)/_layout.tsx`. "(tabs)/index" is listed
 *  too: only the router's index-pop keeps it out of the segment list. */
export const TAB_ROOT_ROUTE_PATTERNS = [
  "(tabs)",
  "(tabs)/index",
  "(tabs)/watch",
  "(tabs)/library",
  "(tabs)/profile",
] as const

/**
 * Routes an SDUI experience owns. R19 excludes them from CREATING a session —
 * `experience/[slug]` and the two section screens it pushes, both of which read
 * their content from `ExperienceProvider`. A session created elsewhere still
 * floats over them (R3, AE17).
 */
export const SESSION_ORIGIN_EXCLUDED_ROUTE_PATTERNS = [
  "experience/[slug]",
  "video/[sectionKey]",
  "collection/[sectionKey]",
] as const

const FULL_SCREEN_ROUTES: ReadonlySet<string> = new Set(
  FULL_SCREEN_ROUTE_PATTERNS,
)
const TAB_ROOT_ROUTES: ReadonlySet<string> = new Set(TAB_ROOT_ROUTE_PATTERNS)
const EXCLUDED_ORIGIN_ROUTES: ReadonlySet<string> = new Set(
  SESSION_ORIGIN_EXCLUDED_ROUTE_PATTERNS,
)

export function isFullScreenRoute(segments: readonly string[]): boolean {
  return FULL_SCREEN_ROUTES.has(routePattern(segments))
}

/** R23's back handler is armed only at a tab root. */
export function isTabRootRoute(segments: readonly string[]): boolean {
  return TAB_ROOT_ROUTES.has(routePattern(segments))
}

/** R19: may a session be created from this route? */
export function canOriginateSession(segments: readonly string[]): boolean {
  return canOriginateRoutePattern(routePattern(segments))
}

/** The same rule for a caller that already holds a pattern — a published
 *  session carries `originPattern`, not the segments it was built from. */
export function canOriginateRoutePattern(pattern: string): boolean {
  return !EXCLUDED_ORIGIN_ROUTES.has(pattern)
}

/**
 * Presentation from the session and the current route.
 *
 * `floating` is the default for every route the tables do not name, because R3
 * promises the window persists across tab changes and further pushes. `exiting`
 * outranks the route tables: a dismissed window animates away wherever the
 * viewer is, and only `exiting` may clear the store.
 */
export function miniPlayerPresentation(
  snapshot: MiniPlayerStoreSnapshot,
  segments: readonly string[],
  openNonRouteSheetCount = 0,
): MiniPlayerPresentation {
  if (!snapshot.session) return "none"
  if (snapshot.dismissal === "exiting") return "exiting"
  if (isFullScreenRoute(segments)) return "full"
  // KTD16 rides the same branch as R11 by RESULT only: the window stops drawing
  // its chrome. The mechanisms differ, and U7/U9 own that difference.
  if (snapshot.pipHold) return "hidden"
  if (isSuppressedBySheet(segments, openNonRouteSheetCount)) return "hidden"
  return "floating"
}
