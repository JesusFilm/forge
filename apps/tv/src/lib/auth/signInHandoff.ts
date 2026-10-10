// When a completed sign-in should hand the viewer back to Home (feat-322).
//
// The viewer approved on their phone and is looking at a TV that still shows a
// sign-in code screen. Parking there makes the approval feel unacknowledged —
// every commercial TV app returns you to browsing. React-free so the rules are
// testable (apps/tv has no render harness); the route only joins them up.

/**
 * Minimum time the confirmed state stays on screen before the handoff.
 *
 * Not cosmetic: the handoff is the ONLY feedback that the phone approval
 * reached this TV, and a jump inside a few hundred ms reads as a glitch rather
 * than a confirmation. Short enough that nobody reaches for the remote.
 */
export const HANDOFF_CONFIRMATION_MS = 1200

/**
 * Cap on waiting for the sign-in aftermath (identity → promotion → account
 * hydrate) before handing off anyway.
 *
 * Waiting at all is what lets Home paint an already-merged shelf: Home reloads
 * Continue Watching on focus, so arriving BEFORE the hydrate lands shows the
 * pre-merge shelf until the next visit. Capping it is what stops a slow or
 * dead network from stranding the viewer on the code screen — the aftermath is
 * best-effort by construction, so abandoning the wait costs nothing.
 */
export const HANDOFF_MAX_WAIT_MS = 4000

/**
 * How much longer to hold the confirmed state so it stays visible for the
 * floor. Zero once the floor has passed — the aftermath usually outlasts it,
 * in which case there is nothing left to wait for.
 *
 * A non-finite or future `grantedAtMs` (a clock that jumped) yields the full
 * floor rather than a negative or absurd wait.
 */
export function remainingConfirmationDelayMs(
  grantedAtMs: number,
  nowMs: number,
  floorMs: number = HANDOFF_CONFIRMATION_MS,
): number {
  if (!Number.isFinite(grantedAtMs) || !Number.isFinite(nowMs)) return floorMs
  const elapsed = nowMs - grantedAtMs
  if (!Number.isFinite(elapsed) || elapsed < 0) return floorMs
  return Math.max(0, Math.min(floorMs, floorMs - elapsed))
}

/**
 * Whether a signed-in state should hand off to Home.
 *
 * `grantCompleted` is the whole point of the rule and the easiest thing to get
 * wrong: it means the device grant finished during THIS mount. Two other paths
 * also produce a signed-in session — a stored session adopted at launch, and a
 * viewer deliberately opening Profile while already signed in — and yanking
 * either of those to Home would make the Profile screen unreachable.
 */
export function shouldHandOffToHome(input: {
  grantCompleted: boolean
  signedIn: boolean
  alreadyHandedOff: boolean
}): boolean {
  return input.grantCompleted && input.signedIn && !input.alreadyHandedOff
}
