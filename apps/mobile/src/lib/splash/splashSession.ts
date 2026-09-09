/**
 * The splash session (KTD11): a module-scope subscribable store, not React
 * context. The host is a `<Stack>` sibling, so no context reaches both the host
 * and the routes that report into the session. It exposes `subscribe` /
 * `getSnapshot` and the host calls `useSyncExternalStore` itself.
 *
 * A factory plus a lazy module singleton, matching `miniPlayer/store.ts`: every
 * decision unit-tests against a fresh instance with no React and no native
 * module, while the app reads one session.
 */

import { AccessibilityInfo } from "react-native"

import { isExternalLaunch, whenDeepLinkOriginsReady } from "../deepLinkOrigin"
import { withTimeout } from "../withTimeout"

export type SplashPresentation = "motion" | "still"
export type SplashExit = "fade" | "cut"

export type SplashSnapshot = {
  /** False until start() has resolved whether the splash plays (KTD5, KTD7). */
  resolved: boolean
  /** THE visibility predicate (KTD6). Every release path clears this one field. */
  visible: boolean
  /** How the splash presents while visible. Null when it never plays. */
  presentation: SplashPresentation | null
  /** How the host must remove the cover once `visible` turns false. */
  exit: SplashExit
}

export type SplashSessionDeps = {
  /** The non-destructive launch-level read. */
  isExternalLaunch: () => boolean
  /** The deep-link gate. Await before the first isExternalLaunch read. */
  whenDeepLinkOriginsReady: () => Promise<void>
  /** AccessibilityInfo.isReduceMotionEnabled, injected so it is testable. */
  isReduceMotionEnabled: () => Promise<boolean>
}

export type SplashSession = {
  subscribe: (listener: () => void) => () => void
  getSnapshot: () => SplashSnapshot
  /** Begins the session. Idempotent per process (R7). */
  start: () => void
  /** Home has something to paint (R3). */
  reportHomeContent: () => void
  /** Home no longer has anything to paint. ExperienceShell swaps its element
   *  type when the slug resolves and remounts Home mid-hold, so a report that
   *  outlived its reporter would hand the cover over to a spinner (R3). */
  retractHomeContent: () => void
  /** The Home fetch failed — release now rather than holding to the ceiling (R15). */
  reportHomeFailure: () => void
  /** An error panel is about to render. Release at once, with no fade (R5). */
  releaseImmediately: () => void
}

/** The fixed brand hold on every cold start (KD2, R3). */
export const SPLASH_HOLD_MS = 2_500

/** The unconditional release, whatever state Home is in (KD3, R4). */
export const SPLASH_CEILING_MS = 6_000

/**
 * The skip decision runs under its own budget, shorter than the hold (KTD5).
 * `whenDeepLinkOriginsReady()` is itself bounded at 3s, which outlasts the hold,
 * so this budget — not that one — is what keeps the first frame on time.
 */
export const SPLASH_SKIP_DECISION_BUDGET_MS = 1_000

/** The Reduce Motion read must land before the first animated frame (KTD7). */
export const SPLASH_REDUCE_MOTION_BUDGET_MS = 500

/**
 * How much of the hold the cover may spend mounting and painting before its
 * animation starts. The hold begins when this session turns the cover visible,
 * not when the first pixel lands, so the sequence must be shorter than the hold
 * by at least this much or the exit fade clips the end of it.
 *
 * Measured at about 200ms on the iPhone 17 Pro Max simulator from a Release
 * build; the allowance is set above that for slower hardware.
 */
export const SPLASH_MOUNT_LAG_ALLOWANCE_MS = 300

const INITIAL_SNAPSHOT: SplashSnapshot = {
  resolved: false,
  visible: false,
  presentation: null,
  exit: "fade",
}

export function createSplashSession(deps: SplashSessionDeps): SplashSession {
  let snapshot: SplashSnapshot = INITIAL_SNAPSHOT
  const listeners = new Set<() => void>()

  let started = false
  let ended = false
  let homeReported = false
  let floorElapsed = false
  let floorTimer: ReturnType<typeof setTimeout> | undefined
  let ceilingTimer: ReturnType<typeof setTimeout> | undefined

  function commit(next: SplashSnapshot) {
    snapshot = next
    for (const listener of listeners) listener()
  }

  function clearTimers() {
    if (floorTimer) clearTimeout(floorTimer)
    if (ceilingTimer) clearTimeout(ceilingTimer)
    floorTimer = undefined
    ceilingTimer = undefined
  }

  /**
   * The one way the session ends. It clears the single visibility predicate and
   * every pending timer, and `ended` stops any later event from raising the
   * cover again (KTD6, R5).
   */
  function release(exit: SplashExit) {
    if (ended) return
    ended = true
    clearTimers()
    commit({
      resolved: true,
      visible: false,
      presentation: snapshot.presentation,
      exit,
    })
  }

  function maybeRelease() {
    if (!snapshot.visible || !floorElapsed || !homeReported) return
    release("fade")
  }

  function becomeVisible(presentation: SplashPresentation) {
    commit({ resolved: true, visible: true, presentation, exit: "fade" })
    // Both clocks start HERE, not at start(): a slow skip decision must not eat
    // into either the brand hold or the ceiling that ends it.
    floorTimer = setTimeout(() => {
      floorElapsed = true
      maybeRelease()
    }, SPLASH_HOLD_MS)
    ceilingTimer = setTimeout(() => release("fade"), SPLASH_CEILING_MS)
  }

  /**
   * A timed-out gate is no answer. Treat it as "no opening URL" and play: a
   * wrong skip removes the animation from every ordinary launch, while a wrong
   * play delays one deep link (KTD5).
   */
  async function decideSkip(): Promise<boolean> {
    try {
      await withTimeout(
        deps.whenDeepLinkOriginsReady(),
        SPLASH_SKIP_DECISION_BUDGET_MS,
      )
      // Inside the try: a throwing read would reject resolve(), and a session
      // stuck unresolved holds the native splash with nobody left to lower it.
      return deps.isExternalLaunch()
    } catch {
      return false
    }
  }

  async function readReduceMotion(): Promise<boolean> {
    try {
      return await withTimeout(
        deps.isReduceMotionEnabled(),
        SPLASH_REDUCE_MOTION_BUDGET_MS,
      )
    } catch {
      return false
    }
  }

  async function resolve(): Promise<void> {
    const [external, reduceMotion] = await Promise.all([
      decideSkip(),
      readReduceMotion(),
    ])
    if (ended) return
    if (external) {
      ended = true
      commit({ ...INITIAL_SNAPSHOT, resolved: true })
      return
    }
    becomeVisible(reduceMotion ? "still" : "motion")
  }

  return {
    subscribe(listener: () => void): () => void {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },

    getSnapshot(): SplashSnapshot {
      return snapshot
    },

    /** Only a cold process start shows a splash, so a resume finds this spent
     *  and does nothing (R7). */
    start(): void {
      if (started || ended) return
      started = true
      void resolve()
    },

    reportHomeContent(): void {
      if (ended) return
      homeReported = true
      maybeRelease()
    },

    retractHomeContent(): void {
      if (ended) return
      homeReported = false
    },

    /** The retry card must be reachable as soon as there is something to retry,
     *  so the failure never waits out the ceiling (R15). */
    reportHomeFailure(): void {
      release("fade")
    },

    /** An immediate cut, from ANY state — the error panel may render before the
     *  session has even resolved, and no cover may sit over it (R5). */
    releaseImmediately(): void {
      release("cut")
    },
  }
}

let session: SplashSession | null = null

/** The app-wide splash session. */
export function getSplashSession(): SplashSession {
  if (!session) {
    session = createSplashSession({
      isExternalLaunch,
      whenDeepLinkOriginsReady,
      isReduceMotionEnabled: () => AccessibilityInfo.isReduceMotionEnabled(),
    })
  }
  return session
}

/** Test seam only. */
export function resetSplashSession(): void {
  session = null
}
