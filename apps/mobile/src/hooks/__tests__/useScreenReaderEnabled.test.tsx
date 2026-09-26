// The cleanup removes a subscription, so every case renders under StrictMode:
// it runs setup -> cleanup -> setup on ONE instance, and the second setup must
// subscribe again (the repo's remount-safety rule).

import { StrictMode, act } from "react"
import { AccessibilityInfo } from "react-native"

import { useScreenReaderEnabled } from "../useScreenReaderEnabled"
import {
  TestRenderer,
  type TestInstance,
} from "../../test-utils/rnTestRenderer"

type Listener = (value: boolean) => void

let listeners: Listener[]
let removeCalls: number
let subscribedEvents: string[]

function armAccessibilityInfo(initial: Promise<boolean>) {
  jest
    .spyOn(AccessibilityInfo, "isScreenReaderEnabled")
    .mockReturnValue(initial)
  jest
    .spyOn(AccessibilityInfo, "addEventListener")
    .mockImplementation((event: string, handler: unknown) => {
      subscribedEvents.push(event)
      listeners.push(handler as Listener)
      return {
        remove: () => {
          removeCalls += 1
          listeners = listeners.filter((l) => l !== handler)
        },
      } as ReturnType<typeof AccessibilityInfo.addEventListener>
    })
}

const seen: boolean[] = []

function Probe() {
  seen.push(useScreenReaderEnabled())
  return null
}

const latest = () => seen[seen.length - 1]

async function render(): Promise<TestInstance> {
  let renderer: TestInstance | undefined
  await act(async () => {
    renderer = TestRenderer.create(
      <StrictMode>
        <Probe />
      </StrictMode>,
    )
  })
  return renderer as TestInstance
}

beforeEach(() => {
  listeners = []
  removeCalls = 0
  subscribedEvents = []
  seen.length = 0
})

afterEach(() => {
  jest.restoreAllMocks()
})

describe("useScreenReaderEnabled (KTD14)", () => {
  it("reports false before the first read answers", async () => {
    armAccessibilityInfo(new Promise<boolean>(() => {}))
    await render()
    expect(latest()).toBe(false)
  })

  it("reports the first read once it answers", async () => {
    armAccessibilityInfo(Promise.resolve(true))
    await render()
    expect(latest()).toBe(true)
  })

  it("listens to screenReaderChanged, not another event", async () => {
    armAccessibilityInfo(Promise.resolve(false))
    await render()
    expect(new Set(subscribedEvents)).toEqual(new Set(["screenReaderChanged"]))
  })

  it("still reports changes after the StrictMode double mount", async () => {
    armAccessibilityInfo(Promise.resolve(false))
    await render()

    // The cycle removed the first subscription; one live one must remain.
    expect(removeCalls).toBeGreaterThanOrEqual(1)
    expect(listeners).toHaveLength(1)

    await act(async () => {
      listeners.forEach((notify) => notify(true))
    })
    expect(latest()).toBe(true)
    await act(async () => {
      listeners.forEach((notify) => notify(false))
    })
    expect(latest()).toBe(false)
  })

  it("stays false when the first read rejects", async () => {
    armAccessibilityInfo(Promise.reject(new Error("unavailable")))
    await render()
    expect(latest()).toBe(false)
  })

  it("leaves no listener and sets no state after unmount", async () => {
    let settle: ((value: boolean) => void) | undefined
    armAccessibilityInfo(
      new Promise<boolean>((resolve) => {
        settle = resolve
      }),
    )
    const renderer = await render()
    await act(async () => {
      renderer.unmount()
    })
    expect(listeners).toHaveLength(0)

    const rendersBefore = seen.length
    await act(async () => {
      settle?.(true)
    })
    expect(seen.length).toBe(rendersBefore)
  })
})
