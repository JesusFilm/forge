/**
 * When the showcase starts and stops: the deliberate-press classifier (R12/AE8) and
 * the launch auto-start gate (R13/AE3). React-free .ts so both are unit-testable —
 * apps/tv has no render harness, and a jest test cannot import `react`.
 */

export type RemoteEventLike = { eventType?: string | null } | null | undefined

export type RemoteEventDecision = "exit" | "ignore"

/** The Home route. Auto-start defers to whatever else the router put on top. */
export const HOME_ROUTE_PATH = "/"

/**
 * Non-deliberate input. A DENYLIST, not an allowlist: R12 promises that ANY deliberate
 * press exits, and an allowlist silently strands whichever hardware keys a remote turns
 * out to send (VideoPlayer.tsx learned this — its allowlist dropped the media buttons).
 */
const IGNORED_EVENT_TYPES = new Set(["focus", "blur"])
const IGNORED_EVENT_PREFIXES = ["pan", "swipe"]

/**
 * Anything that is not focus/blur noise or a touchpad gesture is user intent. Siri-remote
 * rests and swipes must keep the reel playing (AE8), and long variants exit on their own
 * because a held key fires ONLY the long event — its tap recognizer fails.
 */
export function classifyRemoteEvent(
  event: RemoteEventLike,
): RemoteEventDecision {
  const type = event?.eventType
  if (type == null || type === "") return "ignore"
  if (IGNORED_EVENT_TYPES.has(type)) return "ignore"
  if (IGNORED_EVENT_PREFIXES.some((prefix) => type.startsWith(prefix))) {
    return "ignore"
  }
  return "exit"
}

export type AutoStartGateInputs = {
  /** Prefs read from disk. The pre-hydration default is `false` — never act on it. */
  hydrated: boolean
  autoStartEnabled: boolean
  /** This launch already pushed the showcase. Auto-start is launch-only, not idle-driven. */
  alreadyStarted: boolean
  /** The router's ACTIVE path, which is a deep link's route when one is pending. */
  activePath: string | null
}

/**
 * R13: an office TV that power-cycles recovers unattended. Launch-only and single-shot,
 * so one exit ends the demo until the next relaunch (a deliberate v1 boundary).
 */
export function shouldAutoStartShowcase({
  hydrated,
  autoStartEnabled,
  alreadyStarted,
  activePath,
}: AutoStartGateInputs): boolean {
  if (!hydrated || !autoStartEnabled || alreadyStarted) return false
  return activePath === HOME_ROUTE_PATH
}
