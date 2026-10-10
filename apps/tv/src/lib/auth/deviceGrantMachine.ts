// Pure polling state machine for the device grant (feat-322 U4.2).
//
// React-free and clock-injected, per the repo's testable-helper convention:
// apps/tv has no render harness, so any logic left inside a component is
// effectively untested. The wiring that drives this (`useDeviceGrant`) stays
// thin enough to re-read adversarially, because a hook here cannot be covered.
//
// Everything below is a decision ABOUT time, never a read OF it.

import type { DeviceTokens, PollOutcome } from "./deviceGrantClient"

/** RFC 8628 §3.5: a client that is told to slow down adds 5s, cumulatively. */
export const SLOW_DOWN_INCREMENT_MS = 5000

/**
 * Consecutive transport failures tolerated before the screen says something.
 *
 * Transport errors are not OAuth outcomes — a TV on flaky hotel wifi should
 * keep trying rather than dump the viewer back to a fresh code. But silence
 * forever is worse than an honest message, so the machine surfaces the state
 * while continuing to poll.
 */
export const TRANSPORT_ERRORS_BEFORE_WARNING = 3

export type DeviceGrantPhase =
  | { kind: "idle" }
  | { kind: "requesting" }
  | {
      kind: "waiting"
      userCode: string
      verificationUri: string
      verificationUriComplete: string
      /** Absolute deadline, so a backgrounded TV cannot drift. */
      expiresAtMs: number
      intervalMs: number
      /** True once transport has failed repeatedly; still polling. */
      degraded: boolean
    }
  | { kind: "granted"; tokens: DeviceTokens }
  | { kind: "denied" }
  | { kind: "error"; code: string }

export type DeviceGrantState = {
  phase: DeviceGrantPhase
  /** Next poll is due at or after this instant. */
  nextPollAtMs: number
  consecutiveTransportErrors: number
}

export const initialDeviceGrantState: DeviceGrantState = {
  phase: { kind: "idle" },
  nextPollAtMs: 0,
  consecutiveTransportErrors: 0,
}

export type CodeIssued = {
  userCode: string
  verificationUri: string
  verificationUriComplete: string
  expiresInSeconds: number
  intervalSeconds: number
}

export function onCodeRequested(state: DeviceGrantState): DeviceGrantState {
  return { ...state, phase: { kind: "requesting" } }
}

export function onCodeIssued(
  state: DeviceGrantState,
  issued: CodeIssued,
  nowMs: number,
): DeviceGrantState {
  const intervalMs = Math.max(1000, issued.intervalSeconds * 1000)
  return {
    phase: {
      kind: "waiting",
      userCode: issued.userCode,
      verificationUri: issued.verificationUri,
      verificationUriComplete: issued.verificationUriComplete,
      expiresAtMs: nowMs + issued.expiresInSeconds * 1000,
      intervalMs,
      degraded: false,
    },
    nextPollAtMs: nowMs + intervalMs,
    consecutiveTransportErrors: 0,
  }
}

/** Whether a poll is due. The caller owns the timer; this owns the rule. */
export function shouldPoll(state: DeviceGrantState, nowMs: number): boolean {
  return state.phase.kind === "waiting" && nowMs >= state.nextPollAtMs
}

/**
 * Whether the displayed code has passed its own deadline.
 *
 * Checked against an absolute instant rather than a countdown so a TV that was
 * asleep for an hour does not resume believing it has 12 minutes left. R6 wants
 * an expired code replaced in place, which the caller does by requesting a new
 * one — this only reports the fact.
 */
export function isExpired(state: DeviceGrantState, nowMs: number): boolean {
  return state.phase.kind === "waiting" && nowMs >= state.phase.expiresAtMs
}

export function secondsRemaining(
  state: DeviceGrantState,
  nowMs: number,
): number {
  if (state.phase.kind !== "waiting") return 0
  return Math.max(0, Math.ceil((state.phase.expiresAtMs - nowMs) / 1000))
}

/**
 * Fold one poll outcome into the next state.
 *
 * Each branch is reachable by exactly one outcome kind — there is no
 * keep-polling default. An unrecognised error terminates, because RFC 8628
 * treats it as terminal and a permissive fallback would spin against the
 * server's rate limit while the screen looked healthy.
 */
export function onPollOutcome(
  state: DeviceGrantState,
  outcome: PollOutcome,
  nowMs: number,
): DeviceGrantState {
  if (state.phase.kind !== "waiting") return state
  const waiting = state.phase

  switch (outcome.kind) {
    case "granted":
      return {
        phase: { kind: "granted", tokens: outcome.tokens },
        nextPollAtMs: 0,
        consecutiveTransportErrors: 0,
      }

    case "denied":
      return {
        phase: { kind: "denied" },
        nextPollAtMs: 0,
        consecutiveTransportErrors: 0,
      }

    case "expired":
      return {
        phase: { kind: "error", code: "expired_token" },
        nextPollAtMs: 0,
        consecutiveTransportErrors: 0,
      }

    case "unknown_error":
      return {
        phase: { kind: "error", code: outcome.code },
        nextPollAtMs: 0,
        consecutiveTransportErrors: 0,
      }

    case "slow_down": {
      // Cumulative, per RFC 8628 §3.5 — the interval must not snap back on the
      // next successful poll, or a client that is genuinely too fast oscillates.
      const intervalMs = waiting.intervalMs + SLOW_DOWN_INCREMENT_MS
      return {
        phase: { ...waiting, intervalMs },
        nextPollAtMs: nowMs + intervalMs,
        consecutiveTransportErrors: 0,
      }
    }

    case "transport_error": {
      const errors = state.consecutiveTransportErrors + 1
      return {
        phase: {
          ...waiting,
          degraded: errors >= TRANSPORT_ERRORS_BEFORE_WARNING,
        },
        nextPollAtMs: nowMs + waiting.intervalMs,
        consecutiveTransportErrors: errors,
      }
    }

    case "pending":
      return {
        phase: { ...waiting, degraded: false },
        nextPollAtMs: nowMs + waiting.intervalMs,
        consecutiveTransportErrors: 0,
      }
  }
}

/**
 * AppState transitions.
 *
 * Branches on `=== "background"` and never `!== "active"`: tvOS emits
 * `"inactive"` as a foreground blip (Siri, control centre), and treating that
 * as backgrounded would stop the poll every time the viewer summoned Siri,
 * letting the code expire while it sat on screen.
 */
export function shouldPausePolling(appState: string): boolean {
  return appState === "background"
}

/**
 * Resuming from background. The interval is preserved (including any slow_down
 * penalty) but the next poll is due immediately, so a viewer who approved on
 * their phone while the TV slept sees the result on return rather than after
 * another full interval.
 */
export function onForegrounded(
  state: DeviceGrantState,
  nowMs: number,
): DeviceGrantState {
  if (state.phase.kind !== "waiting") return state
  return { ...state, nextPollAtMs: nowMs }
}
