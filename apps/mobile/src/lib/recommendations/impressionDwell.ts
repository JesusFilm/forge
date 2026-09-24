/**
 * Impression eligibility for the Recommended for You row (feat-517 KTD4). A
 * card earns one impression per slate after one continuous second in which
 * four signals hold: the row is at least half visible in Home's list, the card
 * is at least half visible in the row's list, the app is in the foreground,
 * and Home is focused. Any drop cancels the dwell; the next hold restarts it.
 *
 * Two approximations are deliberate, and both under-record rather than
 * over-record. The row's visibility stands in for each card's vertical
 * exposure, because the row's own list only measures the horizontal axis. And
 * both lists report 250 ms after a card crosses the threshold
 * (`minimumViewTime`), so the real dwell is that much longer than one second.
 */
import { datadogLog } from "../datadog"

/** R12: one continuous second of held signals. */
export const IMPRESSION_DWELL_MS = 1_000

/**
 * Both lists read visibility with these settings (KTD4). One shared object,
 * because each list captures its config when it is constructed and ignores
 * every later one. 250 ms is FlashList's own default: a zero settle time runs
 * the check on every scroll tick.
 */
export const IMPRESSION_VIEWABILITY_CONFIG = {
  itemVisiblePercentThreshold: 50,
  minimumViewTime: 250,
}

/** Arms `run` after `delayMs` and answers with its own cancel. */
export type DwellScheduler = (run: () => void, delayMs: number) => () => void

/**
 * Only an explicit background or inactive state stops the dwell. React
 * Native's `AppState.currentState` is null until the native module answers,
 * and reading that silence as "not in the foreground" would drop every
 * impression of the launch.
 */
export function isForegroundAppState(
  state: string | null | undefined,
): boolean {
  return state !== "background" && state !== "inactive"
}

export type ImpressionDwellTracker = {
  /** The slate on display. A new id lets every card record again. */
  setRequestId: (requestId: string | null) => void
  /** Home's list reports the row at least half visible. */
  setRowVisible: (visible: boolean) => void
  /** The row's list reports these card ids at least half visible. */
  setVisibleCards: (itemIds: readonly string[]) => void
  setAppActive: (active: boolean) => void
  setFocused: (focused: boolean) => void
  /** The row unmounted or was recycled: every card signal drops. */
  detachRow: () => void
  /** Cancels every armed dwell and keeps the signals and what was recorded. */
  suspend: () => void
  /** Re-arms from the latest signals after a suspend. */
  resume: () => void
}

export type ImpressionDwellOptions = {
  onImpression: (itemId: string) => void
  schedule?: DwellScheduler
  dwellMs?: number
}

const timeoutScheduler: DwellScheduler = (run, delayMs) => {
  const timer = setTimeout(run, delayMs)
  return () => clearTimeout(timer)
}

function sameMembers(current: Set<string>, next: readonly string[]): boolean {
  if (current.size !== new Set(next).size) return false
  return next.every((itemId) => current.has(itemId))
}

export function createImpressionDwellTracker(
  options: ImpressionDwellOptions,
): ImpressionDwellTracker {
  const schedule = options.schedule ?? timeoutScheduler
  const dwellMs = options.dwellMs ?? IMPRESSION_DWELL_MS

  let requestId: string | null = null
  let rowVisible = false
  let appActive = false
  let focused = false
  let suspended = false
  let visible = new Set<string>()
  const recorded = new Set<string>()
  const armed = new Map<string, () => void>()

  function cancelAll(): void {
    for (const cancel of armed.values()) cancel()
    armed.clear()
  }

  function eligible(itemId: string): boolean {
    return (
      !suspended &&
      requestId != null &&
      rowVisible &&
      appActive &&
      focused &&
      visible.has(itemId) &&
      !recorded.has(itemId)
    )
  }

  function arm(itemId: string): void {
    const slate = requestId
    armed.set(
      itemId,
      schedule(() => {
        armed.delete(itemId)
        // A dwell belongs to one slate: the item ids and their capabilities
        // are per-slate, so a timer that outlived its own records nothing.
        if (slate !== requestId || !eligible(itemId)) return
        recorded.add(itemId)
        options.onImpression(itemId)
      }, dwellMs),
    )
  }

  function reconcile(): void {
    for (const [itemId, cancel] of armed) {
      if (eligible(itemId)) continue
      cancel()
      armed.delete(itemId)
    }
    for (const itemId of visible) {
      if (armed.has(itemId) || !eligible(itemId)) continue
      arm(itemId)
    }
  }

  return {
    setRequestId: (next) => {
      if (next === requestId) return
      requestId = next
      recorded.clear()
      cancelAll()
      reconcile()
    },
    setRowVisible: (next) => {
      if (next === rowVisible) return
      rowVisible = next
      reconcile()
    },
    setVisibleCards: (itemIds) => {
      // The row re-reports on every slate render, so an unchanged report must
      // leave the dwell the viewer already spent alone.
      if (sameMembers(visible, itemIds)) return
      visible = new Set(itemIds)
      reconcile()
    },
    setAppActive: (next) => {
      if (next === appActive) return
      appActive = next
      reconcile()
    },
    setFocused: (next) => {
      if (next === focused) return
      focused = next
      reconcile()
    },
    detachRow: () => {
      if (visible.size === 0) return
      visible = new Set()
      reconcile()
    },
    suspend: () => {
      suspended = true
      cancelAll()
    },
    resume: () => {
      if (!suspended) return
      suspended = false
      reconcile()
    },
  }
}

/**
 * A list's viewability callback runs for the screen's whole life, and an
 * uncaught throw in Home's own list is fatal for Home, not just for this row.
 * The first failure is logged and the rest are dropped: the callback fires on
 * every scroll, so a standing fault would otherwise flood the log.
 */
export function guardViewabilityCallback<T>(
  surface: string,
  report: (info: T) => void,
): (info: T) => void {
  let logged = false
  return (info) => {
    try {
      report(info)
    } catch {
      if (logged) return
      logged = true
      // Never the caught value: it can carry list internals.
      datadogLog.warn("recommendation.viewability_failed", {
        rec_surface: surface,
      })
    }
  }
}
