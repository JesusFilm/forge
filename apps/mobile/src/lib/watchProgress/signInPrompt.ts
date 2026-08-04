/**
 * Contextual sign-in prompt trigger (R17/KTD13): a signed-out session that
 * pauses or leaves mid-video past the meaningful threshold arms a one-shot,
 * dismissible prompt — session-local trigger state (no watch position is
 * ever written, R10), with only the DISMISSAL persisting as a device-local
 * cooldown flag so the nudge doesn't return on every relaunch.
 *
 * The cap is global per session, not per video: browsing several
 * partially-watched titles cannot re-prompt repeatedly.
 */

export const PROMPT_MIN_WATCHED_SECONDS = 30

/** Dismissal cooldown — the prompt stays the occasional nudge R17 intends. */
export const PROMPT_DISMISS_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000

export const SIGN_IN_PROMPT_DISMISSED_AT_STORAGE_KEY =
  "watch-progress-signin-prompt-dismissed-at"

/**
 * Forward-looking by design (KTD13): the position just watched is genuinely
 * not kept (AE4) — promising otherwise breaks the promise at the exact
 * moment it converts someone.
 */
export const SIGN_IN_PROMPT_COPY =
  "Sign in to keep your place across your devices from here on."

// Session-local trigger state (in-memory only — resets on relaunch).
let armed = false
let shownThisSession = false

/** Test-only reset. */
export function __resetSignInPromptSession() {
  armed = false
  shownThisSession = false
}

/**
 * Called when signed-out playback pauses/backgrounds/unmounts. Arms the
 * prompt once the watched position crosses the meaningful threshold.
 */
export function noteSignedOutPlaybackStop(positionSeconds: number) {
  if (shownThisSession) return
  if (!Number.isFinite(positionSeconds)) return
  if (positionSeconds < PROMPT_MIN_WATCHED_SECONDS) return
  armed = true
}

/** Pure cooldown decision — dismissedAtRaw is the persisted flag's value. */
export function isPromptCooldownActive(
  dismissedAtRaw: string | null,
  nowMs: number,
): boolean {
  if (dismissedAtRaw == null) return false
  const dismissedAt = Number.parseInt(dismissedAtRaw, 10)
  if (!Number.isFinite(dismissedAt)) return false
  return nowMs - dismissedAt < PROMPT_DISMISS_COOLDOWN_MS
}

/**
 * Whether the prompt should show now. Signed-in disarms; the global
 * once-per-session cap and the persisted dismissal cooldown both gate.
 */
export function shouldShowSignInPrompt({
  signedIn,
  dismissedAtRaw,
  nowMs,
}: {
  signedIn: boolean
  dismissedAtRaw: string | null
  nowMs: number
}): boolean {
  if (signedIn) {
    armed = false
    return false
  }
  if (!armed || shownThisSession) return false
  return !isPromptCooldownActive(dismissedAtRaw, nowMs)
}

/** The prompt rendered — burn the session's one shot. */
export function markSignInPromptShown() {
  shownThisSession = true
  armed = false
}

/** Serialize the dismissal timestamp for the device-local cooldown flag. */
export function serializePromptDismissal(nowMs: number): string {
  return String(nowMs)
}
