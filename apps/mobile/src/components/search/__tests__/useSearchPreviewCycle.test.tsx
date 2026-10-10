/**
 * Lifecycle coverage for the search grid's preview cycle.
 *
 * The pure ordering lives in previewCycle.ts and is tested beside it. THIS
 * suite covers the part only a render can prove: that one timer chain is armed
 * and only one, that a pass resumes rather than replays, and that it stops when
 * the screen goes away.
 *
 * StrictMode is the default posture, per the repo rule for a hook whose cleanup
 * mutates hook-lifetime refs. Wrapping the ELEMENT is what doubles the effect
 * cycle; a wrapper option would only double initializers.
 */

import { StrictMode, act } from "react"
import type React from "react"
import {
  TestRenderer,
  type TestInstance,
} from "../../../test-utils/rnTestRenderer"
import { AccessibilityInfo, AppState } from "react-native"

import { PREVIEW_HOLD_MS, PREVIEW_START_DELAY_MS } from "../previewCycle"
import { useSearchPreviewCycle } from "../useSearchPreviewCycle"

// Spy on the real objects rather than mocking "react-native": spreading the
// actual module eagerly resolves every TurboModule getter (DevMenu throws), and
// replacing it wholesale removes Platform.select, which jest-expo's setup reads.
let appStateHandler: ((s: string) => void) | null = null
let reduceMotion = false

type Row = {
  label: string | null
  childCount: number | null
  playbackId: string | null
}

const film = (id: string): Row => ({
  label: "shortFilm",
  childCount: 0,
  playbackId: id,
})
const series = (): Row => ({
  label: "series",
  childCount: 4,
  playbackId: "pb-series",
})

type Props = {
  results: Row[]
  visibleIndices: number[]
  enabled: boolean
  passKey: string
}

function render(initial: Props, options: { strict?: boolean } = {}) {
  const strict = options.strict ?? true
  const seen: (number | null)[] = []

  function Harness(props: Props) {
    seen.push(useSearchPreviewCycle(props))
    return null
  }

  const wrap = (el: React.ReactElement) =>
    strict ? ((<StrictMode>{el}</StrictMode>) as React.ReactElement) : el

  let renderer!: TestInstance
  act(() => {
    renderer = TestRenderer.create(
      wrap((<Harness {...initial} />) as React.ReactElement),
    )
  })

  return {
    seen,
    /** Latest value the hook returned. */
    current: () => seen[seen.length - 1] ?? null,
    update: (next: Partial<Props>) =>
      act(() => {
        renderer.update(
          wrap(
            (<Harness {...{ ...initial, ...next }} />) as React.ReactElement,
          ),
        )
        Object.assign(initial, next)
      }),
    unmount: () => act(() => renderer.unmount()),
  }
}

/** Let the reduce-motion promise settle before any timer work. */
const settle = async () => {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

const advance = (ms: number) =>
  act(() => {
    jest.advanceTimersByTime(ms)
  })

beforeEach(() => {
  jest.useFakeTimers()
  appStateHandler = null
  reduceMotion = false
  jest
    .spyOn(AccessibilityInfo, "isReduceMotionEnabled")
    .mockImplementation(async () => reduceMotion)
  jest
    .spyOn(AccessibilityInfo, "addEventListener")
    .mockReturnValue({ remove: jest.fn() } as never)
  jest.spyOn(AppState, "addEventListener").mockImplementation(((
    _event: string,
    handler: (s: string) => void,
  ) => {
    appStateHandler = handler
    return { remove: jest.fn() }
  }) as never)
})

afterEach(() => {
  jest.clearAllTimers()
  jest.useRealTimers()
  jest.restoreAllMocks()
})

describe("useSearchPreviewCycle", () => {
  const base = () => ({
    results: [film("a"), film("b"), film("c")],
    visibleIndices: [0, 1, 2],
    enabled: true,
    passKey: "search-1",
  })

  it("starts on the first eligible card after the settle delay", async () => {
    const h = render(base())
    await settle()
    expect(h.current()).toBeNull()

    advance(PREVIEW_START_DELAY_MS)
    expect(h.current()).toBe(0)
  })

  // The StrictMode point: setup -> cleanup -> setup must leave ONE chain. Two
  // chains would show up as the turn jumping an extra card per hold.
  it("arms exactly one chain under a StrictMode remount", async () => {
    const h = render(base())
    await settle()
    advance(PREVIEW_START_DELAY_MS)
    expect(h.current()).toBe(0)

    advance(PREVIEW_HOLD_MS)
    expect(h.current()).toBe(1)
    advance(PREVIEW_HOLD_MS)
    expect(h.current()).toBe(2)
  })

  it("stops after one pass instead of cycling", async () => {
    const h = render(base())
    await settle()
    advance(PREVIEW_START_DELAY_MS)
    advance(PREVIEW_HOLD_MS)
    advance(PREVIEW_HOLD_MS)
    expect(h.current()).toBe(2)

    advance(PREVIEW_HOLD_MS)
    expect(h.current()).toBeNull()
    advance(PREVIEW_HOLD_MS * 5)
    expect(h.current()).toBeNull()
  })

  it("skips a series and previews a feature film that owns chapters", async () => {
    const h = render({
      results: [
        series(),
        { label: "featureFilm", childCount: 61, playbackId: "pb-jesus" },
      ],
      visibleIndices: [0, 1],
      enabled: true,
      passKey: "search-1",
    })
    await settle()
    advance(PREVIEW_START_DELAY_MS)
    expect(h.current()).toBe(1)
  })

  // Regression for the load-more retry: `enabled` flips false then true on the
  // SAME search, and the pass must resume, never replay from card 0.
  it("resumes rather than replays when enabled flips off and back on", async () => {
    const h = render(base())
    await settle()
    advance(PREVIEW_START_DELAY_MS)
    advance(PREVIEW_HOLD_MS)
    expect(h.current()).toBe(1)

    h.update({ enabled: false })
    expect(h.current()).toBeNull()

    h.update({ enabled: true })
    advance(PREVIEW_START_DELAY_MS)
    expect(h.current()).toBe(2)
  })

  // Regression for the scroll-up dead end: an ended pass must wake for cards
  // the viewer newly reveals, and still never go backwards.
  it("wakes for newly revealed cards after the pass ended", async () => {
    const h = render({
      results: [film("a"), film("b"), film("c"), film("d")],
      visibleIndices: [0, 1],
      enabled: true,
      passKey: "search-1",
    })
    await settle()
    advance(PREVIEW_START_DELAY_MS)
    advance(PREVIEW_HOLD_MS)
    expect(h.current()).toBe(1)
    advance(PREVIEW_HOLD_MS)
    expect(h.current()).toBeNull()

    h.update({ visibleIndices: [2, 3] })
    advance(PREVIEW_START_DELAY_MS)
    expect(h.current()).toBe(2)
  })

  it("resumes into an appended page without replaying the first one", async () => {
    const h = render({
      results: [film("a"), film("b")],
      visibleIndices: [0, 1],
      enabled: true,
      passKey: "search-1",
    })
    await settle()
    advance(PREVIEW_START_DELAY_MS)
    advance(PREVIEW_HOLD_MS)
    advance(PREVIEW_HOLD_MS)
    expect(h.current()).toBeNull()

    h.update({
      results: [film("a"), film("b"), film("c")],
      visibleIndices: [0, 1, 2],
    })
    advance(PREVIEW_START_DELAY_MS)
    expect(h.current()).toBe(2)
  })

  it("starts over from the top on a new search", async () => {
    const h = render(base())
    await settle()
    advance(PREVIEW_START_DELAY_MS)
    advance(PREVIEW_HOLD_MS)
    expect(h.current()).toBe(1)

    h.update({ passKey: "search-2" })
    expect(h.current()).toBeNull()
    advance(PREVIEW_START_DELAY_MS)
    expect(h.current()).toBe(0)
  })

  it("never starts when reduce motion is on", async () => {
    reduceMotion = true
    const h = render(base())
    await settle()
    advance(PREVIEW_START_DELAY_MS + PREVIEW_HOLD_MS * 3)
    expect(h.current()).toBeNull()
  })

  it("stops on background and resumes forward on return", async () => {
    const h = render(base())
    await settle()
    advance(PREVIEW_START_DELAY_MS)
    expect(h.current()).toBe(0)

    act(() => appStateHandler?.("background"))
    expect(h.current()).toBeNull()
    advance(PREVIEW_HOLD_MS * 3)
    expect(h.current()).toBeNull()

    act(() => appStateHandler?.("active"))
    advance(PREVIEW_START_DELAY_MS)
    expect(h.current()).toBe(1)
  })

  it("leaves no timer running after unmount", async () => {
    const h = render(base())
    await settle()
    advance(PREVIEW_START_DELAY_MS)
    h.unmount()
    expect(jest.getTimerCount()).toBe(0)
  })
})
