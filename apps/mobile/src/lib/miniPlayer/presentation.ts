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

import {
  sameSessionContent,
  type MiniPlayerSession,
  type MiniPlayerStoreSnapshot,
} from "./store"
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

/** The five tab roots from `app/(tabs)/_layout.tsx`. "(tabs)/index" is listed
 *  too: only the router's index-pop keeps it out of the segment list. The
 *  pushed Bible reader is the root route "reader", not "(tabs)/bible". */
export const TAB_ROOT_ROUTE_PATTERNS = [
  "(tabs)",
  "(tabs)/index",
  "(tabs)/watch",
  "(tabs)/bible",
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

/** R19: may a session be created from a route with this pattern? A published
 *  session carries `originPattern`, not the segments it was built from. */
export function canOriginateRoutePattern(pattern: string): boolean {
  return !EXCLUDED_ORIGIN_ROUTES.has(pattern)
}

/** feat-551 KTD10: the pushed reader and its three root sheets (`app/_layout.tsx`)
 *  sit over the watch screen's player slot. The Bible tab does not: no watch
 *  slot is mounted under it. */
export const READER_COVER_ROUTE_PATTERNS = [
  "reader",
  "reader-passage",
  "reader-translation",
  "reader-settings",
] as const

/** feat-551 KTD11: every route that shows the reader. */
export const READER_ROUTE_PATTERNS = [
  ...READER_COVER_ROUTE_PATTERNS,
  "(tabs)/bible",
] as const

const READER_COVER_ROUTES: ReadonlySet<string> = new Set(
  READER_COVER_ROUTE_PATTERNS,
)

/** The one cover predicate. The host, the slot poster and the screen's back
 *  button all follow the cover it starts (KTD10). */
export function isReaderCovering(segments: readonly string[]): boolean {
  return READER_COVER_ROUTES.has(routePattern(segments))
}

/** Where the reader runs: the Bible tab, the pushed route, or one of the
 *  three sheets, which can sit over either host. */
export type ReaderRouteKind = "tab" | "pushed" | "sheet"

export function readerRouteKind(
  segments: readonly string[],
): ReaderRouteKind | null {
  const pattern = routePattern(segments)
  if (pattern === "(tabs)/bible") return "tab"
  if (pattern === "reader") return "pushed"
  return READER_COVER_ROUTES.has(pattern) ? "sheet" : null
}

/** What a tap on the window does: go back to the covered screen, or open one. */
export type ExpandAction = "pop" | "push"

/** KTD10, AE14: a tap on the window over the reader goes back to the watch
 *  screen under it, so the stack never holds a second one. Anything else
 *  pushes, as the Bible tab does: no watch slot is mounted under it. */
export function expandAction(input: {
  /** The current slot is covered and its window floats. */
  covered: boolean
  descriptor: Pick<MiniPlayerSession, "videoId" | "videoSlug"> | null
  session: Pick<MiniPlayerSession, "videoId" | "videoSlug"> | null
  segments: readonly string[]
}): ExpandAction {
  if (!input.covered || input.descriptor == null || input.session == null)
    return "push"
  if (!sameSessionContent(input.descriptor, input.session)) return "push"
  return routePattern(input.segments) === "reader" ? "pop" : "push"
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
