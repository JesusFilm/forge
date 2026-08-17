/**
 * R11 suppression: the floating window hides while an in-app sheet is
 * presented, and returns to its corner when that sheet closes. Two mechanisms
 * live here because the app presents sheets two ways — six real sheet ROUTES
 * in the watch and series groups, and two sheets that are component state.
 *
 * React-native-free by construction: routes arrive as expo-router segments and
 * the non-route sheets arrive as a count.
 */

/**
 * expo-router segments → the route pattern. Group segments stay in ("(tabs)"),
 * dynamic segments stay as their pattern name ("[slug]"), so a video slugged
 * literally "language" is never mistaken for the language sheet.
 */
export function routePattern(segments: readonly string[]): string {
  return segments.filter(Boolean).join("/")
}

/**
 * The six group sheet routes, read from `app/watch/_layout.tsx` and
 * `app/series/_layout.tsx` — every screen either layout declares with
 * `presentation: "formSheet"`.
 */
export const IN_APP_SHEET_ROUTE_PATTERNS = [
  "watch/language",
  "watch/subtitle",
  "watch/download",
  "series/language",
  "series/subtitle",
  "series/download",
] as const

const SHEET_ROUTE_SET: ReadonlySet<string> = new Set(
  IN_APP_SHEET_ROUTE_PATTERNS,
)

export function isInAppSheetRoute(segments: readonly string[]): boolean {
  return SHEET_ROUTE_SET.has(routePattern(segments))
}

/**
 * The two sheets that are component state rather than routes: the Library
 * delete confirmation (`src/components/library/DeleteConfirmSheet.tsx`, hosted
 * by `app/(tabs)/library.tsx`) and the SDUI quiz modal.
 */
export type NonRouteSheetId = "libraryDeleteConfirm" | "sduiQuiz"

export type NonRouteSheetCounter = {
  /** Presented count — zero means nothing is suppressing the window. */
  count: () => number
  isPresented: () => boolean
  open: (id: NonRouteSheetId) => void
  close: (id: NonRouteSheetId) => void
  subscribe: (listener: () => void) => () => void
}

/**
 * Keyed by sheet id rather than a bare integer: a double open or a stray close
 * would otherwise strand the window hidden with no way back (R11 promises the
 * return), and the id makes an unbalanced call attributable.
 */
export function createNonRouteSheetCounter(): NonRouteSheetCounter {
  const open = new Set<NonRouteSheetId>()
  const listeners = new Set<() => void>()

  function notify() {
    for (const listener of listeners) listener()
  }

  return {
    count: () => open.size,
    isPresented: () => open.size > 0,
    open(id) {
      if (open.has(id)) return
      open.add(id)
      notify()
    },
    close(id) {
      if (!open.delete(id)) return
      notify()
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}

let counter: NonRouteSheetCounter | null = null

/** The app-wide non-route sheet counter the sheet hosts increment and release. */
export function getNonRouteSheetCounter(): NonRouteSheetCounter {
  if (!counter) counter = createNonRouteSheetCounter()
  return counter
}

/**
 * The R11 predicate. It does NOT exempt the full-screen view — the presentation
 * selector owns that ordering, because the three watch-group sheets sit over
 * the full screen rather than over the window.
 */
export function isSuppressedBySheet(
  segments: readonly string[],
  openNonRouteSheetCount = 0,
): boolean {
  return openNonRouteSheetCount > 0 || isInAppSheetRoute(segments)
}
