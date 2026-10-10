// The wiring that drives the device-grant state machine (feat-322 U4.2).
//
// Deliberately thin. apps/tv has no render harness, so nothing in a hook can be
// covered by a test — every DECISION therefore lives in `deviceGrantMachine.ts`
// (pure, clock-injected, 26 tests) and this file only supplies the clock, the
// timer, and the network.
//
// StrictMode: the AbortController and the timer are effect-LOCAL, not
// hook-lifetime refs, so a `setup → cleanup → setup` cycle produces fresh ones
// rather than resuming with a poisoned latch. The two refs that do span the
// hook's life are re-armed in setup for the same reason.

import { useCallback, useEffect, useRef, useState } from "react"
import { AppState } from "react-native"

import {
  createPkcePair,
  getDeviceGrantConfig,
  pollDeviceToken,
  requestDeviceCode,
} from "./deviceGrantClient"
import {
  initialDeviceGrantState,
  isExpired,
  onCodeIssued,
  onCodeRequested,
  onForegrounded,
  onPollOutcome,
  secondsRemaining,
  shouldPausePolling,
  shouldPoll,
  type DeviceGrantState,
} from "./deviceGrantMachine"
import { adoptTokens } from "./session"

/** How often the driver wakes to ask the machine whether anything is due. */
const TICK_MS = 1000

type Grant = { deviceCode: string; verifier: string }

export type UseDeviceGrant = {
  state: DeviceGrantState
  /** Whole seconds left on the displayed code, for the countdown. */
  secondsLeft: number
  start: () => void
  reset: () => void
}

export function useDeviceGrant(enabled: boolean): UseDeviceGrant {
  const [state, setState] = useState<DeviceGrantState>(initialDeviceGrantState)
  const [secondsLeft, setSecondsLeft] = useState(0)

  // Spans the hook's life: the machine holds the DISPLAY of the grant, this
  // holds the two secrets that must never reach a render.
  const grantRef = useRef<Grant | null>(null)
  // Guards against a slow poll overlapping the next tick.
  const pollingRef = useRef(false)
  // Read by the interval so the timer is created once rather than per tick.
  const stateRef = useRef(state)
  stateRef.current = state

  const reset = useCallback(() => {
    grantRef.current = null
    pollingRef.current = false
    setState(initialDeviceGrantState)
    setSecondsLeft(0)
  }, [])

  const [runId, setRunId] = useState(0)
  const start = useCallback(() => {
    reset()
    setRunId((id) => id + 1)
  }, [reset])

  useEffect(() => {
    if (!enabled || runId === 0) return

    const controller = new AbortController()
    // Re-armed in SETUP, not left to cleanup: under StrictMode this same hook
    // instance is torn down and set up again, so a flag left true by an
    // in-flight poll would wedge the new cycle permanently.
    pollingRef.current = false

    async function issueCode(): Promise<void> {
      try {
        setState(onCodeRequested(stateRef.current))
        const pkce = await createPkcePair()
        const config = getDeviceGrantConfig()
        const grant = await requestDeviceCode(config, pkce.challenge)
        if (controller.signal.aborted) return
        grantRef.current = {
          deviceCode: grant.deviceCode,
          verifier: pkce.verifier,
        }
        if (__DEV__) {
          // Metro is the only console a physical TV has. The code itself must
          // never appear here — same rule as telemetry — so this logs shape,
          // not content.
          console.log(
            `[device-grant] event=code_issued len=${grant.userCode.length} expires_in=${grant.expiresInSeconds}s interval=${grant.intervalSeconds}s`,
          )
        }
        setState(onCodeIssued(stateRef.current, grant, Date.now()))
      } catch (error) {
        if (controller.signal.aborted) return
        setState({
          phase: {
            kind: "error",
            code: error instanceof Error ? error.message : "device_code_failed",
          },
          nextPollAtMs: 0,
          consecutiveTransportErrors: 0,
        })
      }
    }

    async function poll(): Promise<void> {
      const grant = grantRef.current
      if (grant == null || pollingRef.current) return
      pollingRef.current = true
      try {
        const outcome = await pollDeviceToken(
          getDeviceGrantConfig(),
          grant.deviceCode,
          grant.verifier,
        )
        if (controller.signal.aborted) return
        const next = onPollOutcome(stateRef.current, outcome, Date.now())
        setState(next)
        if (next.phase.kind === "granted") {
          // The secrets have done their job; drop them before anything else can
          // reach them.
          grantRef.current = null
          await adoptTokens(next.phase.tokens)
        }
      } catch {
        // The transport already maps failures to outcomes, so reaching here
        // means something unforeseen. Swallowing is deliberate: an unhandled
        // rejection in dev escalates to an all-native RCTFatal with no JS
        // message, which is far harder to diagnose than a stalled poll.
      } finally {
        pollingRef.current = false
      }
    }

    void issueCode()

    const timer = setInterval(() => {
      const now = Date.now()
      const current = stateRef.current
      setSecondsLeft(secondsRemaining(current, now))

      if (shouldPausePolling(AppState.currentState)) return
      // R6: an expired code is replaced in place rather than left on screen for
      // someone to type into a form that will reject it.
      if (isExpired(current, now)) {
        void issueCode()
        return
      }
      if (shouldPoll(current, now)) void poll()
    }, TICK_MS)

    const subscription = AppState.addEventListener("change", (next) => {
      if (!shouldPausePolling(next)) {
        setState(onForegrounded(stateRef.current, Date.now()))
      }
    })

    return () => {
      controller.abort()
      clearInterval(timer)
      subscription.remove()
    }
  }, [enabled, runId])

  return { state, secondsLeft, start, reset }
}
