// The run of one Daily Bible Pause (KTD4, KTD11, R5, R6, R10). The steps are
// states of one reducer, not routes. Begin and Resume pin the day key and the
// devotional, and every step write uses that pinned key until the close.
import { useEffect, useMemo, useReducer } from "react"

import {
  PAUSE_STEPS,
  getPauseProgressStore,
  type PauseProgressStore,
  type PauseStep,
} from "./progress"
import type { Today } from "./today"

/** A step after the Opening. Only these steps carry a pinned day. */
export type RunStep = Exclude<PauseStep, "opening">

export type RunState =
  | { readonly step: "opening"; readonly pin: null }
  | { readonly step: RunStep; readonly pin: Today }

export type RunAction =
  | { type: "begin"; today: Today }
  | { type: "startOver"; today: Today }
  | { type: "resume"; today: Today; step: PauseStep }
  | { type: "advance" }
  | { type: "jump"; step: RunStep }
  | { type: "reset" }

export const RUN_START: RunState = Object.freeze({
  step: "opening",
  pin: null,
})

/** The three video parts. The close sits in their letterbox (R24). */
export function isVideoPart(step: PauseStep): boolean {
  return step === "film" || step === "teaching" || step === "prayer"
}

export function runReducer(state: RunState, action: RunAction): RunState {
  switch (action.type) {
    case "begin":
    case "startOver":
      return { step: "watchScreen", pin: action.today }
    case "resume":
      // R6: the step starts again from its beginning, because it mounts anew.
      if (action.step === "opening") return state
      return { step: action.step, pin: action.today }
    case "advance": {
      if (state.step === "opening" || state.step === "share") return state
      const next = PAUSE_STEPS[PAUSE_STEPS.indexOf(state.step) + 1] as RunStep
      return { step: next, pin: state.pin }
    }
    case "jump":
      // A stepper tap opens any section, back or ahead (the owner, 2026-10-08).
      if (state.step === "opening") return state
      return { step: action.step, pin: state.pin }
    case "reset":
      return RUN_START
  }
}

export type DailyPauseRun = {
  state: RunState
  begin(today: Today): void
  resume(today: Today, step: PauseStep): void
  /** The Watch screen again; its write replaces the saved step. */
  startOver(today: Today): void
  advance(): void
  /** Another step of the same run, as a stepper tap asks. */
  jump(step: RunStep): void
  /** The Opening again, with no pinned day. */
  reset(): void
}

export function useDailyPauseRun(
  store: PauseProgressStore = getPauseProgressStore(),
): DailyPauseRun {
  const [state, dispatch] = useReducer(runReducer, RUN_START)

  // A write follows each new state, so a StrictMode reducer replay writes
  // nothing twice. The Opening writes nothing: it must keep the saved step.
  useEffect(() => {
    if (state.step === "opening") return
    store.recordStep(state.pin.dayKey, state.step)
  }, [state, store])

  return useMemo(
    () => ({
      state,
      begin: (today) => dispatch({ type: "begin", today }),
      resume: (today, step) => dispatch({ type: "resume", today, step }),
      startOver: (today) => dispatch({ type: "startOver", today }),
      advance: () => dispatch({ type: "advance" }),
      jump: (step) => dispatch({ type: "jump", step }),
      reset: () => dispatch({ type: "reset" }),
    }),
    [state],
  )
}
