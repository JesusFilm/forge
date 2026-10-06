// Shared helpers for the Daily Bible Pause suites.
import { act } from "react"

import type { PauseFace } from "../lib/dailyPause/fonts"
import type { RenderedNode, TestInstance } from "./rnTestRenderer"

/** A font that names its face, so a suite can read which face a text uses. */
export const pauseTestFont = (face: PauseFace) => ({ fontFamily: face })

/** Small steps, so React commits between timers as it does on a phone. */
export function advance(ms: number) {
  for (let left = ms; left > 0; left -= 250) {
    act(() => {
      jest.advanceTimersByTime(Math.min(250, left))
    })
  }
}

/** The pulse wrappers that ask for a tap. */
export function pulses(root: TestInstance): RenderedNode[] {
  return root.root.findAll(
    (node) =>
      typeof node.type === "string" && node.props.testID === "pause-pulse",
  )
}
