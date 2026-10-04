import { act } from "react"

import {
  TestRenderer,
  unmount,
  type TestInstance,
} from "../../test-utils/rnTestRenderer"
import { endPause, requestPause, usePauseRequested } from "../pauseCurtain"

const seen: boolean[] = []

function Probe() {
  seen.push(usePauseRequested())
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
  seen.length = 0
})

describe("the curtain store", () => {
  it("starts down", async () => {
    const renderer = await mount()
    expect(seen.at(-1)).toBe(false)
    await unmount(renderer)
  })

  it("goes up on request and down when the stage ends it", async () => {
    const renderer = await mount()
    act(() => requestPause())
    expect(seen.at(-1)).toBe(true)
    act(() => endPause())
    expect(seen.at(-1)).toBe(false)
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
})
