// R11 suppression inputs. Two independent sources: route sheets, which expo
// -router puts in the segments, and the two modal components that own no route
// and so cannot be seen from the segments at all.

/** Root-stack groups that declare formSheet screens beside their `[slug]`. */
const SHEET_GROUPS = new Set(["watch", "series"])

/**
 * The sheet screens each group declares. Derived from app/watch/_layout.tsx and
 * app/series/_layout.tsx — three each, six in total. Keep this in step with
 * those two files; a sheet added there and not here silently stops suppressing.
 */
export const SHEET_SCREENS = ["language", "subtitle", "download"] as const

const SHEET_SCREEN_SET = new Set<string>(SHEET_SCREENS)

/** Is the viewer on one of the six group sheet routes? */
export function isSheetRoute(segments: readonly string[]): boolean {
  return (
    SHEET_GROUPS.has(segments[0] ?? "") &&
    SHEET_SCREEN_SET.has(segments[1] ?? "")
  )
}

/**
 * A counter, not a boolean: the two sheets that own no route
 * (library's DeleteConfirmSheet and the QuizButtonRenderer modal) can overlap,
 * and a boolean would let the first one to close reveal the window under the
 * second. Balanced open/close pairs are the caller's contract; the count floors
 * at zero so an unbalanced close cannot wedge the window hidden forever.
 */
export function createSheetCounter() {
  let open = 0
  let resetGeneration = 0
  const listeners = new Set<() => void>()

  const notify = () => {
    for (const listener of [...listeners]) listener()
  }

  return {
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    getCount: () => open,
    /**
     * Bumped by every reset. Only a claimant knows whether its own claim is
     * still live, so this is what lets one re-assert after a reset dropped it.
     */
    getResetGeneration: () => resetGeneration,
    openSheet() {
      open += 1
      notify()
    },
    closeSheet() {
      if (open === 0) return
      open -= 1
      notify()
    },
    /** Route changes can strand a count; the host resets on session end. */
    reset() {
      if (open === 0) return
      open = 0
      resetGeneration += 1
      notify()
    },
  }
}

export type SheetCounter = ReturnType<typeof createSheetCounter>
