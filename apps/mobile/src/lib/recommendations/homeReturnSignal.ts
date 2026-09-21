/**
 * feat-517 KTD5: the return-from-watch refresh trigger, as a pure rule over
 * two route-segment lists. Home runs it on each segment transition; the focus
 * event is not used, because the focus listener and the segment update are two
 * effects of one navigation commit with no guaranteed order.
 */
import { TAB_GROUP_SEGMENT, isTabGroupRoute } from "../tabBar"

/**
 * The root-stack routes that open the managed player. The SDUI `video`,
 * `collection` and `experience` routes also play video and are deliberately
 * absent: they are not a watch route (KTD5).
 */
const WATCH_ROUTE_SEGMENTS: readonly string[] = ["watch", "series"]

/**
 * Did the viewer just leave a watch route for the tab group? Key on the
 * `(tabs)` GROUP marker, never a tab name — the Discover tab is itself named
 * `watch`, and a name-keyed rule would refresh on every tab switch.
 */
export function isReturnToHomeFromWatch(
  previous: readonly string[],
  next: readonly string[],
): boolean {
  if (isTabGroupRoute(previous)) return false
  const from = previous[0]
  if (from == null || !WATCH_ROUTE_SEGMENTS.includes(from)) return false
  // The router may omit the trailing `index` segment for the Home tab, so the
  // group marker alone decides; a later group segment is a different route.
  return next[0] === TAB_GROUP_SEGMENT
}

/** Parse the joined key Home keeps in its ref back into segments. */
export function routeSegmentsFromKey(key: string): string[] {
  return key === "" ? [] : key.split("/")
}
