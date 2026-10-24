import { describe, expect, it } from "vitest"
import {
  createViewingModeRecorder,
  type ViewingModeInterval,
  type ViewingModeSnapshot,
} from "./viewing-mode-recorder"

function harness() {
  let at = 0
  let state: ViewingModeSnapshot = {
    positionSeconds: 0,
    durationSeconds: 120,
    playing: true,
    visible: true,
    mode: "sound_off",
    preview: true,
    playbackRate: 1,
  }
  const intervals: ViewingModeInterval[] = []
  const recorder = createViewingModeRecorder({
    read: () => state,
    now: () => at,
    emit: (value) => intervals.push(value),
  })
  recorder.sample()
  return {
    intervals,
    recorder,
    advance(milliseconds: number, changes: Partial<ViewingModeSnapshot> = {}) {
      at += milliseconds
      state = {
        ...state,
        positionSeconds:
          state.positionSeconds + (milliseconds / 1000) * state.playbackRate,
        ...changes,
      }
      recorder.sample()
    },
    transition(changes: Partial<ViewingModeSnapshot>) {
      state = { ...state, ...changes }
      recorder.sample()
    },
  }
}

describe("sound-off visible playback capture", () => {
  it("retains the actual interval end when a later sample is stalled or delayed", () => {
    let at = 0
    let position = 0
    const ends: number[] = []
    const recorder = createViewingModeRecorder({
      now: () => at,
      read: () => ({
        positionSeconds: position,
        durationSeconds: 120,
        playing: true,
        visible: true,
        mode: "sound_off",
        preview: true,
        playbackRate: 1,
      }),
      emit: (_, endedAt) => ends.push(endedAt),
    })
    recorder.sample()
    at = 3_000
    position = 3
    recorder.sample()
    at = 30_000
    recorder.sample()
    expect(ends).toEqual([3_000])
  })
  it("records sustained muted preview playback without a Watch now click", () => {
    const h = harness()
    for (let i = 0; i < 30; i++) h.advance(1_000)
    expect(h.intervals).toHaveLength(3)
    expect(
      h.intervals.reduce((sum, value) => sum + value.activeMilliseconds, 0),
    ).toBe(30_000)
    expect(
      h.intervals.every((value) => value.mode === "sound_off" && value.preview),
    ).toBe(true)
  })

  it.each([
    { visible: false },
    { visible: null },
    { playing: false },
    { mode: null },
  ] as const)("excludes non-observable playback %j", (changes) => {
    const h = harness()
    h.transition(changes)
    for (let i = 0; i < 30; i++) h.advance(1_000)
    h.recorder.flush()
    expect(h.intervals).toEqual([])
  })

  it("splits sound and preview transitions without double counting", () => {
    const h = harness()
    for (let i = 0; i < 6; i++) h.advance(1_000)
    h.transition({ mode: "sound_on", preview: false })
    for (let i = 0; i < 4; i++) h.advance(1_000)
    h.recorder.flush()
    expect(
      h.intervals.map((value) => [
        value.mode,
        value.preview,
        value.activeMilliseconds,
      ]),
    ).toEqual([
      ["sound_off", true, 6_000],
      ["sound_on", false, 4_000],
    ])
  })

  it("does not turn seeking, frozen frames or long sample gaps into watch time", () => {
    const h = harness()
    h.advance(1_000, { positionSeconds: 60 })
    h.advance(1_000, { positionSeconds: 60 })
    h.advance(30_000)
    h.recorder.flush()
    expect(h.intervals).toEqual([])
  })

  it("splits loop jumps and measures wall time at non-default playback rates", () => {
    const h = harness()
    h.transition({ playbackRate: 2 })
    h.advance(2_000)
    h.advance(500, { positionSeconds: 0 })
    h.advance(2_000)
    h.recorder.flush()
    expect(
      h.intervals.map((value) => [
        value.activeMilliseconds,
        value.fromSeconds,
        value.toSeconds,
      ]),
    ).toEqual([
      [2_000, 0, 4],
      [2_000, 0, 4],
    ])
  })
})
