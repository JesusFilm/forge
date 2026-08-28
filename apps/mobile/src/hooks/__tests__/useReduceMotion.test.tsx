/**
 * The hook subscribes on mount and tears the subscription down in cleanup, and
 * that is the repo's recorded trigger for a remount-safety defect: dev
 * StrictMode runs setup -> cleanup -> setup against the SAME hook instance, so
 * anything cleanup poisons must be re-armed by the next setup. Every case here
 * therefore renders under `<StrictMode>` — wrapping the rendered ELEMENT is
 * what doubles the effect cycle.
 */

import { StrictMode, act } from "react"
import { AccessibilityInfo } from "react-native"

import { useReduceMotion } from "../useReduceMotion"
import {
  TestRenderer,
  type TestInstance,
} from "../../test-utils/rnTestRenderer"

type Listener = (value: boolean) => void

let listeners: Listener[]
let removeCalls: number

function armAccessibilityInfo(initial: Promise<boolean>) {
  jest
    .spyOn(AccessibilityInfo, "isReduceMotionEnabled")
    .mockReturnValue(initial)
  jest
    .spyOn(AccessibilityInfo, "addEventListener")
    .mockImplementation((event: string, handler: unknown) => {
      expect(event).toBe("reduceMotionChanged")
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
  seen.push(useReduceMotion())
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
  seen.length = 0
})

afterEach(() => {
  jest.restoreAllMocks()
})

describe("useReduceMotion", () => {
  it("reports false before the initial read resolves", async () => {
    // A never-settling read: the hook must not block the first paint on it.
    armAccessibilityInfo(new Promise<boolean>(() => {}))
    await render()
    expect(latest()).toBe(false)
  })

  it("reports the initial value once the read resolves", async () => {
    armAccessibilityInfo(Promise.resolve(true))
    await render()
    expect(latest()).toBe(true)
  })

  it("re-renders when the OS setting changes while mounted", async () => {
    armAccessibilityInfo(Promise.resolve(false))
    await render()
    expect(latest()).toBe(false)

    await act(async () => {
      listeners.forEach((notify) => notify(true))
    })
    expect(latest()).toBe(true)
  })

  it("leaves no listener behind after unmount", async () => {
    armAccessibilityInfo(Promise.resolve(false))
    const renderer = await render()

    await act(async () => {
      renderer.unmount()
    })
    expect(listeners).toHaveLength(0)
  })

  it("re-arms across a setup-cleanup-setup cycle rather than staying torn down", async () => {
    armAccessibilityInfo(Promise.resolve(false))
    await render()

    // StrictMode already ran the full cycle above. Exactly one subscription
    // must survive it, and it must still be live.
    expect(removeCalls).toBeGreaterThanOrEqual(1)
    expect(listeners).toHaveLength(1)

    await act(async () => {
      listeners.forEach((notify) => notify(true))
    })
    expect(latest()).toBe(true)
  })

  it("stays at false when the initial read rejects, without throwing", async () => {
    // A failed accessibility read must not take the card down with it.
    armAccessibilityInfo(Promise.reject(new Error("unavailable")))
    await render()
    expect(latest()).toBe(false)
  })

  it("does not update state from a read that resolves after unmount", async () => {
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

    const rendersBefore = seen.length
    await act(async () => {
      settle?.(true)
    })
    expect(seen.length).toBe(rendersBefore)
  })
})
