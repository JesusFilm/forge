/**
 * The sliding selector. `onLayout` never fires on its own under
 * react-test-renderer, so every branch here needs the event driven by hand --
 * without that, `segment` stays 0 and the component renders nothing at all.
 */
import { act } from "react"
import { Animated } from "react-native"

import {
  TAB_BAR_LENS_DURATION_MS,
  TAB_BAR_LENS_INSET,
  TAB_ROUTE_NAMES,
} from "../../../lib/tabBar"
import {
  TestRenderer,
  type RenderedNode,
  type TestInstance,
} from "../../../test-utils/rnTestRenderer"
import { TabBarLens } from "../TabBarLens"

// The `mock` prefix is required: babel-plugin-jest-hoist lifts jest.mock above
// this declaration and rejects any other out-of-scope name in the factory.
const mockSegments: { current: string[] } = { current: ["(tabs)"] }
jest.mock("expo-router", () => ({
  useSegments: () => mockSegments.current,
}))

const BAR_WIDTH = 400
const SEGMENT = BAR_WIDTH / TAB_ROUTE_NAMES.length

afterEach(() => {
  mockSegments.current = ["(tabs)"]
  jest.restoreAllMocks()
})

function outer(renderer: TestInstance): RenderedNode {
  return renderer.root.findAll((n) => typeof n.props.onLayout === "function")[0]
}

/** The animated capsule, absent until a non-zero width has been measured.
 *  Identified by its transform -- the outer measuring box carries a style too. */
function capsuleStyle(
  renderer: TestInstance,
): Record<string, unknown> | undefined {
  for (const node of renderer.root.findAll(
    (n) => n.props.style !== undefined,
  )) {
    const raw = node.props.style
    const flat = Array.isArray(raw)
      ? Object.assign({}, ...raw.filter(Boolean))
      : (raw as Record<string, unknown>)
    if (flat && "transform" in flat) return flat
  }
  return undefined
}

async function render(): Promise<TestInstance> {
  let renderer!: TestInstance
  await act(async () => {
    renderer = TestRenderer.create(<TabBarLens />)
  })
  return renderer
}

async function measure(renderer: TestInstance, width = BAR_WIDTH) {
  await act(async () => {
    const onLayout = outer(renderer).props.onLayout as (e: unknown) => void
    onLayout({ nativeEvent: { layout: { width } } })
  })
}

describe("before a width is measured", () => {
  it("draws no capsule at all", async () => {
    const renderer = await render()
    // segment === 0, so the component is an empty measuring box. Every other
    // suite in the repo stops here, which is why nothing below was covered.
    expect(capsuleStyle(renderer)).toBeUndefined()
  })
})

describe("first placement", () => {
  it("jumps rather than sliding, so a cold launch does not animate from Home", async () => {
    mockSegments.current = ["(tabs)", "profile"]
    const timing = jest.spyOn(Animated, "timing")
    const renderer = await render()
    await measure(renderer)

    expect(timing).not.toHaveBeenCalled()
    expect(capsuleStyle(renderer)).toBeDefined()
  })

  it("sizes the capsule to one cell, inset on both sides", async () => {
    const renderer = await render()
    await measure(renderer)
    expect(capsuleStyle(renderer)!.width).toBe(SEGMENT - TAB_BAR_LENS_INSET * 2)
  })
})

describe("moving between tabs", () => {
  it("slides on a later index change", async () => {
    const renderer = await render()
    await measure(renderer)

    const timing = jest.spyOn(Animated, "timing")
    mockSegments.current = ["(tabs)", "library"]
    await act(async () => {
      renderer.update(<TabBarLens />)
    })

    expect(timing).toHaveBeenCalledTimes(1)
    const [, config] = timing.mock.calls[0]
    expect(config.duration).toBe(TAB_BAR_LENS_DURATION_MS)
    expect(config.toValue).toBe(2 * SEGMENT)
    expect(config.useNativeDriver).toBe(true)
  })

  it("HOLDS its cell while a route is pushed over the bar", async () => {
    // app/watch/[slug].tsx is a sibling of the group and emits a bare "watch"
    // segment. Before the fix the capsule slid to Discover on every video open.
    mockSegments.current = ["(tabs)", "library"]
    const renderer = await render()
    await measure(renderer)

    const timing = jest.spyOn(Animated, "timing")
    mockSegments.current = ["watch", "[slug]"]
    await act(async () => {
      renderer.update(<TabBarLens />)
    })

    expect(timing).not.toHaveBeenCalled()
  })
})

describe("teardown", () => {
  it("stops an in-flight animation when it unmounts", async () => {
    const renderer = await render()
    await measure(renderer)

    const stop = jest.fn()
    jest
      .spyOn(Animated, "timing")
      .mockReturnValue({ start: jest.fn(), stop } as never)
    mockSegments.current = ["(tabs)", "profile"]
    await act(async () => {
      renderer.update(<TabBarLens />)
    })

    await act(async () => {
      renderer.unmount()
    })
    expect(stop).toHaveBeenCalled()
  })
})
