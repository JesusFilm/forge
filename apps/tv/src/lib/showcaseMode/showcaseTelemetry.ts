/**
 * Showcase Mode's telemetry decisions (R15/KTD-9). React- and SDK-free .ts so every
 * rule below unit-tests without the native Datadog SDK: the callers own the emit,
 * exactly as seriesScreenState.ts leaves addDatadogTiming to the series screen.
 */

import type { ReelPhase } from "./reelState"
import type { ShowcaseQueueKind } from "./types"

/**
 * Time from the /showcase RUM view's start to the reel's first confirmed frame — the
 * one place addDatadogTiming is right here, because that view IS the mode starting.
 * Per-excerpt TTFF is a `ttff_ms` log field instead; it must not carry nav latency.
 */
export const SHOWCASE_FIRST_FRAME_TIMING = "showcase_first_frame"

/** Constant names: every variable part rides the context, never the action name (PII). */
export const SHOWCASE_START_ACTION = "showcase_start"
export const SHOWCASE_EXIT_ACTION = "showcase_exit"

export type ShowcaseOnceLatch = {
  /** True exactly once; every later call is false. */
  claim: () => boolean
}

/**
 * A fire-once gate for a per-session report. Callers hold one in a ref, so a genuine
 * unmount re-arms it (a new instance) while a re-render, a re-run effect, or a remote
 * press that double-delivers cannot report the same thing twice.
 */
export function createShowcaseOnceLatch(): ShowcaseOnceLatch {
  let claimed = false
  return {
    claim() {
      if (claimed) return false
      claimed = true
      return true
    },
  }
}

/** Which reel the session got. `stills` is R16's floor — degraded, not an error. */
export type ShowcaseStartPath = "curated" | "fallback" | "stills"

/** Route param the auto-start gate stamps so its sessions are separable in RUM. */
export const SHOWCASE_SOURCE_PARAM = "src"
export const SHOWCASE_AUTO_SOURCE = "auto"

/** R13/AE3's field check: did the office TV recover on its own, or did a human start it? */
export type ShowcaseStartSource = "manual" | "auto"

/**
 * Only the auto-start gate stamps the param, so `auto` is always true when claimed.
 * Everything else — Settings, a deep link — is `manual`: not auto-started is the
 * distinction AE3 needs, and no other caller can honestly claim `auto`.
 */
export function resolveShowcaseStartSource(
  param: unknown,
): ShowcaseStartSource {
  const value = Array.isArray(param) ? param[0] : param
  return value === SHOWCASE_AUTO_SOURCE ? "auto" : "manual"
}

/**
 * The reel is presenting something, which is the first moment `showcase_start` can
 * name its path. A press that exits during the resolving window never started.
 */
export function hasShowcaseStarted(phase: ReelPhase): boolean {
  return phase !== "resolving" && phase !== "exited"
}

export function resolveShowcaseStartPath(
  queue: { kind: ShowcaseQueueKind } | null | undefined,
): ShowcaseStartPath {
  // No queue IS the stills floor: the reducer retains the last-good queue through
  // stills, so null means the ladder never found content — not a mid-refresh gap.
  return queue?.kind ?? "stills"
}

export type ShowcaseExitReason = "press" | "background" | "navigation"

export type ShowcaseExitInputs = {
  /** U6's classifier drove the reel to its terminal exit — a deliberate press. */
  exitedViaPress: boolean
  /** Read from AppState at the instant of the decision, never mirrored from state. */
  appForeground: boolean
}

/**
 * Why the session ended. Press wins over everything: a press landing as the app
 * backgrounds is still the viewer leaving, and R12 is the promise being measured.
 */
export function resolveShowcaseExitReason({
  exitedViaPress,
  appForeground,
}: ShowcaseExitInputs): ShowcaseExitReason {
  if (exitedViaPress) return "press"
  if (!appForeground) return "background"
  return "navigation"
}

export type ReelRebufferInputs = {
  /** The excerpt the player confirmed playing; null before the reel's first frame. */
  confirmedToken: number | null
  /** The excerpt the reel last asked the player to load. */
  targetToken: number
}

/**
 * KTD-9's rebuffer gate. One identity carries both of videoQoe's signals because the
 * reel's tokens only climb: an unconfirmed token never started, a confirmed one behind
 * the target is mid-swap — so neither an initial load nor a rotation counts as a stall.
 */
export function shouldCountReelRebuffer({
  confirmedToken,
  targetToken,
}: ReelRebufferInputs): boolean {
  return confirmedToken === targetToken
}
