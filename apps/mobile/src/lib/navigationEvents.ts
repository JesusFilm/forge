/**
 * The one app-owned wrapper over expo-router's navigation-action stream
 * (KTD4). The router API is `unstable_`-prefixed, so exactly one module may
 * name it: an expo-router upgrade that renames or drops it breaks here and
 * nowhere else, with one fallback to reason about instead of many.
 *
 * FALLBACK: when the stream is unavailable this reports NOTHING and hands back
 * a no-op unsubscribe. Nothing throws and nothing arms, so a back press simply
 * stops shrinking the window into the corner — presentation stays derived from
 * route state, which KTD4 requires anyway. Back is never intercepted here.
 * `isNavigationBackStreamAvailable()` makes that state observable, so a caller
 * can report the degrade rather than let it pass silently.
 *
 * expo-router is required lazily, mirroring `authSession.ts`'s client getter:
 * a module-scope import pulls the whole router graph into every suite that
 * touches this file, and the repo forbids importing expo-router unmocked.
 *
 * Verified against expo-router 57.0.12 (2026-08-18): `ExpoRoot` calls
 * `handleNavigationOnReady()` on every navigation-ready, so `actionDispatched`
 * fires with no `unstable_navigationEvents.enable()` call. That switch gates
 * the per-screen page events (`pageFocused` and siblings), which this app does
 * not use and which cost a mounted listener component per route.
 */

/** A dispatched action that pops the current screen. */
export type NavigationBackEvent = {
  /** The react-navigation action type: `GO_BACK`, `POP` or `POP_TO_TOP`. */
  actionType: string
}

// react-navigation's three pop actions. `GO_BACK` is `router.back()` and the
// Android hardware button; native-stack's header button and swipe dispatch
// `POP` once the gesture commits; `POP_TO_TOP` is a tab re-press.
const BACK_ACTION_TYPES = new Set(["GO_BACK", "POP", "POP_TO_TOP"])

type ActionDispatchedEvent = { actionType: string }

type NavigationEventsStream = {
  addListener: (
    type: "actionDispatched",
    callback: (event: ActionDispatchedEvent) => void,
  ) => () => void
}

const NOOP_UNSUBSCRIBE = () => {}

/* eslint-disable @typescript-eslint/no-require-imports */
function resolveStream(): NavigationEventsStream | null {
  try {
    const router = require("expo-router") as {
      unstable_navigationEvents?: Partial<NavigationEventsStream>
    }
    const stream = router?.unstable_navigationEvents
    if (typeof stream?.addListener !== "function") return null
    return stream as NavigationEventsStream
  } catch {
    return null
  }
}
/* eslint-enable @typescript-eslint/no-require-imports */

/** Whether the router still exposes the stream this wrapper reads. */
export function isNavigationBackStreamAvailable(): boolean {
  return resolveStream() != null
}

/**
 * Report every dispatched back action. Returns an unsubscribe that is always
 * safe to call, including on the unavailable path.
 */
export function subscribeToNavigationBack(
  listener: (event: NavigationBackEvent) => void,
): () => void {
  const stream = resolveStream()
  if (stream == null) return NOOP_UNSUBSCRIBE
  try {
    return stream.addListener("actionDispatched", (event) => {
      if (!BACK_ACTION_TYPES.has(event?.actionType)) return
      listener({ actionType: event.actionType })
    })
  } catch {
    return NOOP_UNSUBSCRIBE
  }
}
