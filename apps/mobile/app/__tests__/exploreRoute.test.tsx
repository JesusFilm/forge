/**
 * R46: iOS NativeTabs render every tab at launch (KTD13), so the route waits for
 * its first focus. While the gate is closed it renders nothing at all (KTD16).
 */
import { StrictMode, act, useEffect } from "react"

import {
  TestRenderer,
  type TestInstance,
} from "../../src/test-utils/rnTestRenderer"
import {
  useExploreFocus,
  type ExploreFocus,
} from "../../src/hooks/useExploreFocus"
import ExploreTab from "../(tabs)/explore"

type Listener = () => void

// The `mock` prefix is required: babel-plugin-jest-hoist lifts jest.mock above
// these declarations and rejects any other out-of-scope name in the factory.
const mockExploreAvailable = { current: true }
const mockNavigation = {
  focused: false,
  listeners: new Map<string, Set<Listener>>(),
  isFocused(): boolean {
    return this.focused
  },
  addListener(event: string, listener: Listener): () => void {
    const set = this.listeners.get(event) ?? new Set<Listener>()
    set.add(listener)
    this.listeners.set(event, set)
    return () => set.delete(listener)
  },
}

jest.mock("expo-router", () => ({
  useNavigation: () => mockNavigation,
}))
jest.mock("../../src/lib/explore/availability", () => ({
  isExploreAvailable: () => mockExploreAvailable.current,
}))

function listenerCount(): number {
  let count = 0
  mockNavigation.listeners.forEach((set) => (count += set.size))
  return count
}

async function emit(event: "focus" | "blur") {
  mockNavigation.focused = event === "focus"
  await act(async () => {
    mockNavigation.listeners.get(event)?.forEach((listener) => listener())
  })
}

async function render(element: React.ReactElement): Promise<TestInstance> {
  let renderer!: TestInstance
  await act(async () => {
    renderer = TestRenderer.create(element)
  })
  return renderer
}

function hasFeedSlot(renderer: TestInstance): boolean {
  return (
    renderer.root.findAll((node) => node.props.testID === "explore-feed-slot")
      .length > 0
  )
}

const fetchDescriptor = Object.getOwnPropertyDescriptor(globalThis, "fetch")
const mockFetch = jest.fn()

beforeEach(() => {
  Object.defineProperty(globalThis, "fetch", {
    value: mockFetch,
    configurable: true,
    writable: true,
  })
})

afterEach(() => {
  jest.useRealTimers()
  if (fetchDescriptor)
    Object.defineProperty(globalThis, "fetch", fetchDescriptor)
  mockFetch.mockReset()
  mockExploreAvailable.current = true
  mockNavigation.focused = false
  mockNavigation.listeners.clear()
})

describe("the Explore route while the gate is closed", () => {
  it("renders nothing and does not listen for focus", async () => {
    mockExploreAvailable.current = false
    mockNavigation.focused = true
    const renderer = await render(<ExploreTab />)
    expect(renderer.toJSON()).toBeNull()
    expect(listenerCount()).toBe(0)
  })
})

// Sync act on purpose: an async act schedules one timer of its own, which the
// count below would read as the route's.
function renderSync(element: React.ReactElement): TestInstance {
  let renderer!: TestInstance
  act(() => {
    renderer = TestRenderer.create(element)
  })
  return renderer
}

function TimerDecoy() {
  useEffect(() => {
    const id = setTimeout(() => {}, 1000)
    return () => clearTimeout(id)
  }, [])
  return null
}

describe("the Explore route before its first focus (R46)", () => {
  it("starts no timer and no fetch, and mounts no feed", () => {
    jest.useFakeTimers()
    const renderer = renderSync(<ExploreTab />)
    expect(jest.getTimerCount()).toBe(0)
    expect(mockFetch).not.toHaveBeenCalled()
    expect(hasFeedSlot(renderer)).toBe(false)
  })

  it("counts a timer that a mounted component starts (positive control)", () => {
    jest.useFakeTimers()
    renderSync(<TimerDecoy />)
    expect(jest.getTimerCount()).toBe(1)
  })

  it("ignores a blur that comes before any focus", async () => {
    const renderer = await render(<ExploreTab />)
    await emit("blur")
    expect(hasFeedSlot(renderer)).toBe(false)
  })
})

describe("the Explore route at its first focus", () => {
  it("mounts the feed slot on focus and keeps it after a blur", async () => {
    const renderer = await render(<ExploreTab />)
    await emit("focus")
    expect(hasFeedSlot(renderer)).toBe(true)
    await emit("blur")
    expect(hasFeedSlot(renderer)).toBe(true)
  })

  it("mounts the feed slot at once when the route opens focused", async () => {
    // A deep link to /explore mounts the route already focused.
    mockNavigation.focused = true
    const renderer = await render(<ExploreTab />)
    expect(hasFeedSlot(renderer)).toBe(true)
  })

  it("removes both listeners on unmount", async () => {
    const renderer = await render(<ExploreTab />)
    expect(listenerCount()).toBe(2)
    await act(async () => renderer.unmount())
    expect(listenerCount()).toBe(0)
  })

  it("latches under StrictMode's double effect cycle", async () => {
    const renderer = await render(
      <StrictMode>
        <ExploreTab />
      </StrictMode>,
    )
    // The first setup's listeners are gone; only the second setup's remain.
    expect(listenerCount()).toBe(2)
    expect(hasFeedSlot(renderer)).toBe(false)
    await emit("focus")
    expect(hasFeedSlot(renderer)).toBe(true)
  })
})

describe("useExploreFocus", () => {
  const seen: ExploreFocus[] = []
  function Probe() {
    seen.push(useExploreFocus())
    return null
  }

  afterEach(() => {
    seen.length = 0
  })

  it("tracks focus and latches the first one", async () => {
    await render(<Probe />)
    expect(seen.at(-1)).toEqual({ focused: false, hasFocused: false })
    await emit("focus")
    expect(seen.at(-1)).toEqual({ focused: true, hasFocused: true })
    await emit("blur")
    expect(seen.at(-1)).toEqual({ focused: false, hasFocused: true })
    await emit("focus")
    expect(seen.at(-1)).toEqual({ focused: true, hasFocused: true })
  })

  it("catches a focus that lands before its listener attaches", async () => {
    // The navigator can focus the tab between the first render and the
    // effect. Home seeds from isFocused() at render only and would miss it.
    let calls = 0
    const isFocused = mockNavigation.isFocused
    mockNavigation.isFocused = function () {
      calls += 1
      return calls > 1
    }
    try {
      await render(<Probe />)
    } finally {
      mockNavigation.isFocused = isFocused
    }
    expect(seen.at(-1)).toEqual({ focused: true, hasFocused: true })
  })
})
