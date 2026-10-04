import { act } from "react"

import {
  TestRenderer,
  unmount,
  type TestInstance,
} from "../../test-utils/rnTestRenderer"
import {
  endPause,
  getPausePhase,
  liftPause,
  reportLogoDrawn,
  requestPause,
  setPauseRunOnTop,
  usePausePhase,
  type PausePhase,
} from "../pauseCurtain"

const seen: PausePhase[] = []

function Probe() {
  seen.push(usePausePhase())
  return null
}

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

  it("ignores a request while the run is on top", () => {
    setPauseRunOnTop(true)
    requestPause()
    expect(getPausePhase()).toBe("idle")
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
