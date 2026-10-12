import { act } from "react"

import {
  TestRenderer,
  unmount,
  type TestInstance,
} from "../../test-utils/rnTestRenderer"
import {
  endPause,
  getPauseExitTarget,
  getPausePhase,
  liftPause,
  reportLogoDrawn,
  requestPause,
  requestPauseExit,
  getEntryRequestsOnTop,
  setPauseRunOnTop,
  usePauseDirection,
  usePausePhase,
  type PauseDirection,
  type PausePhase,
} from "../pauseCurtain"

const seen: PausePhase[] = []
const directions: PauseDirection[] = []

function Probe() {
  seen.push(usePausePhase())
  directions.push(usePauseDirection())
  return null
}

const QUESTION = "How are we commanded to pray?"

async function mount(): Promise<TestInstance> {
  let renderer!: TestInstance
  await act(async () => {
    renderer = TestRenderer.create(<Probe />)
  })
  return renderer
}

afterEach(() => {
  act(() => endPause())
  setPauseRunOnTop(false)
  seen.length = 0
  directions.length = 0
})

describe("the curtain store", () => {
  it("starts with no curtain", async () => {
    const renderer = await mount()
    expect(seen.at(-1)).toBe("idle")
    await unmount(renderer)
  })

  it("closes on request, is drawn when the pen ends, lifts, then ends", async () => {
    const renderer = await mount()
    act(() => requestPause())
    expect(seen.at(-1)).toBe("closing")
    act(() => reportLogoDrawn())
    expect(seen.at(-1)).toBe("drawn")
    act(() => liftPause())
    expect(seen.at(-1)).toBe("lifting")
    act(() => endPause())
    expect(seen.at(-1)).toBe("idle")
    await unmount(renderer)
  })

  it("does not re-render subscribers for a repeated request", async () => {
    const renderer = await mount()
    act(() => requestPause())
    const renders = seen.length
    act(() => requestPause())
    expect(seen).toHaveLength(renders)
    await unmount(renderer)
  })

  it("ignores a request while the curtain lifts", () => {
    requestPause()
    liftPause()
    requestPause()
    expect(getPausePhase()).toBe("lifting")
  })

  it("ignores a request while the run is on top, and counts it for the run", () => {
    setPauseRunOnTop(true)
    const before = getEntryRequestsOnTop()
    requestPause()
    expect(getPausePhase()).toBe("idle")
    expect(getEntryRequestsOnTop()).toBe(before + 1)
    setPauseRunOnTop(false)
    requestPause()
    expect(getPausePhase()).toBe("closing")
  })

  it("lifts back before the pen ends, and the pen's end then changes nothing", () => {
    requestPause()
    liftPause()
    reportLogoDrawn()
    expect(getPausePhase()).toBe("lifting")
  })

  it("does not lift a curtain that is down", () => {
    liftPause()
    expect(getPausePhase()).toBe("idle")
  })
})

// v2 R17, R18, KTD5: Share leaves the run through the same curtain.
describe("the exit direction", () => {
  it("closes from idle with the run on top, and leaves the entry count alone", async () => {
    const renderer = await mount()
    expect(directions.at(-1)).toBe("entry")
    setPauseRunOnTop(true)
    const before = getEntryRequestsOnTop()
    act(() => requestPauseExit({ kind: "home" }))
    expect(seen.at(-1)).toBe("closing")
    expect(directions.at(-1)).toBe("exit")
    expect(getPauseExitTarget()).toEqual({ kind: "home" })
    expect(getEntryRequestsOnTop()).toBe(before)
    await unmount(renderer)
  })

  it("refuses a second exit while the first closes, and drops an entry", () => {
    setPauseRunOnTop(true)
    requestPauseExit({ kind: "search", question: QUESTION })
    requestPauseExit({ kind: "home" })
    expect(getPauseExitTarget()).toEqual({ kind: "search", question: QUESTION })
    const before = getEntryRequestsOnTop()
    requestPause()
    expect(getPausePhase()).toBe("closing")
    expect(getEntryRequestsOnTop()).toBe(before)
    expect(getPauseExitTarget()).toEqual({ kind: "search", question: QUESTION })
  })

  it("refuses an exit while an entry's curtain is up", async () => {
    const renderer = await mount()
    act(() => requestPause())
    act(() => requestPauseExit({ kind: "home" }))
    expect(directions.at(-1)).toBe("entry")
    expect(getPauseExitTarget()).toBeNull()
    await unmount(renderer)
  })

  it("clears the direction and the target when the curtain ends", async () => {
    const renderer = await mount()
    act(() => requestPauseExit({ kind: "search", question: QUESTION }))
    act(() => reportLogoDrawn())
    act(() => liftPause())
    expect(directions.at(-1)).toBe("exit")
    act(() => endPause())
    expect(seen.at(-1)).toBe("idle")
    expect(directions.at(-1)).toBe("entry")
    expect(getPauseExitTarget()).toBeNull()
    // The next request is an entry again.
    act(() => requestPause())
    expect(directions.at(-1)).toBe("entry")
    await unmount(renderer)
  })
})
