// The one wrapper over React Navigation's `__unsafe_action__` stream (KTD4),
// named here ONLY: presentation derives from route state, so this exists just
// to ARM the window before a pop commits, which orders the Android handoff.

/** The caller passes the ref in so this module never imports expo-router,
 *  which cannot be imported unmocked under this repo's jest setup. */
export type NavigationActionSource = {
  addListener: (
    event: "__unsafe_action__",
    listener: (payload: unknown) => void,
  ) => (() => void) | { remove: () => void } | void
}

export type NavigationIntent = "back" | "other"

/**
 * Does this action pop the current screen? GO_BACK is the button and the
 * gesture; POP and POP_TO_TOP are the programmatic forms.
 */
const BACK_ACTION_TYPES = new Set(["GO_BACK", "POP", "POP_TO_TOP"])

/**
 * Classify one raw action payload. Defensive by construction: this reads an
 * explicitly unstable stream, so an unrecognised or malformed payload is
 * "other" rather than a throw. Guessing "back" would shrink the player on a
 * forward push.
 */
export function classifyNavigationAction(payload: unknown): NavigationIntent {
  if (typeof payload !== "object" || payload == null) return "other"
  const data = (payload as { data?: unknown }).data
  if (typeof data !== "object" || data == null) return "other"
  const action = (data as { action?: unknown }).action
  if (typeof action !== "object" || action == null) return "other"
  const type = (action as { type?: unknown }).type
  return typeof type === "string" && BACK_ACTION_TYPES.has(type)
    ? "back"
    : "other"
}

/**
 * Subscribe to back intents. Returns an unsubscribe that is always safe to
 * call.
 *
 * Documented fallback: when the ref is absent or exposes no listener API — a
 * router upgrade renaming the unstable event, or a call before the container
 * mounts — this reports nothing and returns a no-op. The window then still
 * works, because presentation is derived from route state; only the pre-pop
 * arming is lost, which costs the Android handoff its ordering, not its
 * correctness.
 */
export function subscribeToBackIntent(
  source: NavigationActionSource | null | undefined,
  listener: () => void,
): () => void {
  if (source == null || typeof source.addListener !== "function")
    return () => {}

  let removal: (() => void) | { remove: () => void } | void
  try {
    removal = source.addListener("__unsafe_action__", (payload) => {
      if (classifyNavigationAction(payload) === "back") listener()
    })
  } catch {
    // An upgrade that removed the event throws here rather than returning.
    return () => {}
  }

  return () => {
    try {
      if (typeof removal === "function") removal()
      else if (removal != null && typeof removal.remove === "function")
        removal.remove()
    } catch {
      // Already torn down with the container.
    }
  }
}
