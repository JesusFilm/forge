// The run of one Daily Bible Pause (KTD4, KTD11, R5, R6, R10; v2 plan R3).
// The steps are states of one reducer, not routes. Begin and Resume pin the day
// key and the devotional, and every step write uses that key until the close.
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
  | { type: "reset" }

export const RUN_START: RunState = Object.freeze({
  step: "opening",
  pin: null,
})

/** The three sections of a run: the stepper's pills and the video markers. */
export type StepperStage = "watch" | "reflect" | "pray"

/** The three video parts. The close sits in their letterbox (R24). */
export function isVideoPart(step: PauseStep): boolean {
  return sectionForStep(step) != null
}

/** The section of a video part, or null on any other step (v2 plan R3). */
export function sectionForStep(step: PauseStep): StepperStage | null {
  switch (step) {
    case "film":
      return "watch"
    case "teaching":
      return "reflect"
    case "prayer":
      return "pray"
    default:
      return null
  }
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
      reset: () => dispatch({ type: "reset" }),
    }),
    [state],
  )
}
