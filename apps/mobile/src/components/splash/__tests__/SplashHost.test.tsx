/**
 * The splash cover's ownership of the native splash and of its own exit (U5).
 *
 * The sequence is stubbed: its own suite covers the motion, and this one is
 * about WHEN the cover releases the native splash, HOW it leaves, and what the
 * tree beneath it looks like to a screen reader.
 */

jest.mock("../../../lib/splash/nativeSplash", () => ({
  hideNativeSplashOnce: jest.fn(),
}))

jest.mock("../../../lib/splash/splashSession", () => {
  const initial = {
    resolved: false,
    visible: false,
    presentation: null,
    exit: "fade",
  }
  let snapshot = initial
  const listeners = new Set<() => void>()
  const session = {
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    getSnapshot: () => snapshot,
  }
  const releaseImmediately = jest.fn()
  return {
    getSplashSession: () => ({ ...session, releaseImmediately }),
    __releaseImmediately: releaseImmediately,
    __setSnapshot: (next: Record<string, unknown>) => {
      snapshot = { ...snapshot, ...next }
      for (const listener of [...listeners]) listener()
    },
    __resetSnapshot: () => {
      snapshot = initial
      listeners.clear()
    },
  }
})

jest.mock("../SplashSequence", () => {
  const react = jest.requireActual("react") as typeof import("react")
  const seen: {
    props: { reduceMotion: boolean; onFirstFrame?: () => void }
    throws: boolean
  } = { props: { reduceMotion: false }, throws: false }
  const SplashSequence = (props: {
    reduceMotion: boolean
    onFirstFrame?: () => void
  }) => {
    if (seen.throws) throw new Error("geometry blew up")
    seen.props = props
    return react.createElement("SplashSequenceStub", null)
  }
  return { __esModule: true, SplashSequence, __seen: seen }
})

import { act, createElement } from "react"
import { Animated, View } from "react-native"

import {
  SplashCoveredTree,
  SplashHost,
  SPLASH_EXIT_BACKSTOP_MS,
  SPLASH_EXIT_FADE_MS,
} from "../SplashHost"
import {
  TestRenderer,
  type RenderedNode,
  type TestInstance,
} from "../../../test-utils/rnTestRenderer"

const nativeSplash = jest.requireMock("../../../lib/splash/nativeSplash") as {
  hideNativeSplashOnce: jest.Mock
}
const sessionMock = jest.requireMock("../../../lib/splash/splashSession") as {
  __setSnapshot: (next: Record<string, unknown>) => void
  __resetSnapshot: () => void
  __releaseImmediately: jest.Mock
}
const sequenceMock = jest.requireMock("../SplashSequence") as {
  __seen: {
    props: { reduceMotion: boolean; onFirstFrame?: () => void }
    throws: boolean
  }
}

type FadeSpy = {
  config?: { toValue?: unknown; duration?: number }
  finish?: (result: { finished: boolean }) => void
  calls: number
}
let fade: FadeSpy

beforeEach(() => {
  jest.clearAllMocks()
  sessionMock.__resetSnapshot()
  sequenceMock.__seen.throws = false
  fade = { calls: 0 }
  jest.spyOn(Animated, "timing").mockImplementation(((
    _value: Animated.Value,
    config: { toValue?: unknown; duration?: number },
  ) => {
    fade.calls += 1
    fade.config = config
    return {
      start: (callback?: (result: { finished: boolean }) => void) => {
        fade.finish = callback
      },
      stop: () => {},
      reset: () => {},
    }
  }) as unknown as typeof Animated.timing)
})

afterEach(() => {
  jest.restoreAllMocks()
})

function renderHost(): TestInstance {
  let renderer: TestInstance | undefined
  act(() => {
    renderer = TestRenderer.create(createElement(SplashHost))
  })
  if (!renderer) throw new Error("render failed")
  return renderer
}

function setSnapshot(next: Record<string, unknown>) {
  act(() => {
    sessionMock.__setSnapshot(next)
  })
}

function firstFrame() {
  act(() => {
    sequenceMock.__seen.props.onFirstFrame?.()
  })
}

function coverNodes(renderer: TestInstance): RenderedNode[] {
  // Host nodes only: a composite and the host it renders carry the same props,
  // so an unfiltered match counts one cover three times.
  return renderer.root.findAll(
    (node) =>
      node.props.testID === "splash-host" && typeof node.type === "string",
  )
}

function play(renderer: TestInstance) {
  setSnapshot({ resolved: true, visible: true, presentation: "motion" })
  firstFrame()
  expect(coverNodes(renderer).length).toBeGreaterThan(0)
}

describe("SplashHost", () => {
  it("holds the native splash until the layer reports a painted frame", () => {
    const renderer = renderHost()
    setSnapshot({ resolved: true, visible: true, presentation: "motion" })
    // Mounting is not painting. Releasing here would show the app tree through
    // the gap between the native frame and the first drawn one (R2).
    expect(nativeSplash.hideNativeSplashOnce).not.toHaveBeenCalled()

    firstFrame()
    expect(nativeSplash.hideNativeSplashOnce).toHaveBeenCalledTimes(1)
    expect(coverNodes(renderer).length).toBe(1)
  })

  it("releases the native splash on the skip path, where nothing is drawn", () => {
    const renderer = renderHost()
    expect(nativeSplash.hideNativeSplashOnce).not.toHaveBeenCalled()

    // A deep-link launch never becomes visible. Without this the held flat
    // field would cover the destination screen forever (R6).
    setSnapshot({ resolved: true, visible: false })
    expect(nativeSplash.hideNativeSplashOnce).toHaveBeenCalledTimes(1)
    expect(coverNodes(renderer).length).toBe(0)
  })

  it("fades the cover out and unmounts it only once the fade finishes", () => {
    const renderer = renderHost()
    play(renderer)

    setSnapshot({ visible: false, exit: "fade" })
    expect(fade.calls).toBe(1)
    expect(fade.config?.toValue).toBe(0)
    expect(fade.config?.duration).toBe(SPLASH_EXIT_FADE_MS)
    // Still on screen while it fades — Home is already painted underneath it.
    expect(coverNodes(renderer).length).toBe(1)

    act(() => {
      fade.finish?.({ finished: true })
    })
    expect(coverNodes(renderer).length).toBe(0)
  })

  it("cuts the cover on the error-panel release, with no fade", () => {
    const renderer = renderHost()
    play(renderer)

    setSnapshot({ visible: false, exit: "cut" })
    expect(fade.calls).toBe(0)
    expect(coverNodes(renderer).length).toBe(0)
  })

  it("carries the compositing and modal flags the cover depends on", () => {
    const renderer = renderHost()
    play(renderer)

    const cover = coverNodes(renderer).at(0)
    // Without offscreen compositing Android applies the fade's opacity to each
    // child, so the app tree bleeds through it.
    expect(cover?.props.needsOffscreenAlphaCompositing).toBe(true)
    expect(cover?.props.accessibilityViewIsModal).toBe(true)
    // The tree beneath is live. A stray tap must not navigate it.
    expect(typeof cover?.props.onStartShouldSetResponder).toBe("function")
    expect(cover?.props.pointerEvents).toBe("auto")
  })

  it("stops holding the person off the moment the predicate clears", () => {
    const renderer = renderHost()
    play(renderer)

    setSnapshot({ visible: false, exit: "fade" })
    const cover = coverNodes(renderer).at(0)
    // The cover is still on screen for the whole fade. SplashCoveredTree drops
    // its Android isolation the instant `visible` turns false, so these two
    // must drop with it — otherwise a screen-reader user can reach Home and
    // have the tap swallowed by a picture (R16, one predicate).
    expect(cover?.props.accessibilityViewIsModal).toBe(false)
    expect(cover?.props.pointerEvents).toBe("none")
  })

  it("removes the cover even when the fade never reports finished", () => {
    jest.useFakeTimers()
    try {
      const renderer = renderHost()
      play(renderer)
      setSnapshot({ visible: false, exit: "fade" })
      expect(fade.calls).toBe(1)

      // The completion callback is the only latch that unmounts the cover, and
      // an invisible full-screen layer still swallows every touch.
      act(() => {
        jest.advanceTimersByTime(SPLASH_EXIT_FADE_MS + SPLASH_EXIT_BACKSTOP_MS)
      })
      expect(coverNodes(renderer).length).toBe(0)
    } finally {
      jest.useRealTimers()
    }
  })

  it("hands the sequence the presentation the session resolved", () => {
    const renderer = renderHost()
    setSnapshot({ resolved: true, visible: true, presentation: "still" })
    expect(sequenceMock.__seen.props.reduceMotion).toBe(true)

    act(() => renderer.unmount())
    sessionMock.__resetSnapshot()
    const second = renderHost()
    setSnapshot({ resolved: true, visible: true, presentation: "motion" })
    expect(sequenceMock.__seen.props.reduceMotion).toBe(false)
    act(() => second.unmount())
  })
})

describe("a cover that throws", () => {
  it("costs the splash, never the app", () => {
    // The app has ONE error boundary. Without a boundary of its own, a broken
    // animation would swap the whole tree for the App Error panel.
    const consoleError = jest
      .spyOn(console, "error")
      .mockImplementation(() => {})
    try {
      sequenceMock.__seen.throws = true
      const renderer = renderHost()
      setSnapshot({ resolved: true, visible: true, presentation: "motion" })

      expect(coverNodes(renderer).length).toBe(0)
      // Both, or the failure outlives the layer: the native splash is not
      // React's to remove, and the session still hides the tree beneath from
      // a screen reader.
      expect(nativeSplash.hideNativeSplashOnce).toHaveBeenCalled()
      expect(sessionMock.__releaseImmediately).toHaveBeenCalled()
      act(() => renderer.unmount())
    } finally {
      consoleError.mockRestore()
    }
  })
})

describe("SplashCoveredTree", () => {
  function renderTree(): TestInstance {
    let renderer: TestInstance | undefined
    act(() => {
      renderer = TestRenderer.create(
        createElement(
          SplashCoveredTree,
          null,
          createElement(View, { testID: "beneath" }),
        ),
      )
    })
    if (!renderer) throw new Error("render failed")
    return renderer
  }

  function isolation(renderer: TestInstance): unknown {
    const nodes = renderer.root.findAll(
      (node) => node.props.importantForAccessibility !== undefined,
    )
    expect(nodes.length).toBeGreaterThan(0)
    return nodes[0]?.props.importantForAccessibility
  }

  it("hides the covered tree from the accessibility tree while the cover is up", () => {
    const renderer = renderTree()
    expect(isolation(renderer)).toBe("auto")

    setSnapshot({ resolved: true, visible: true, presentation: "motion" })
    expect(isolation(renderer)).toBe("no-hide-descendants")

    // The SAME predicate that clears the cover clears the isolation (R16).
    setSnapshot({ visible: false, exit: "fade" })
    expect(isolation(renderer)).toBe("auto")
  })
})
