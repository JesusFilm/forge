/**
 * The auto-hiding chrome and its published glass value (feat-699 U3, KTD5).
 * Animated is faked: native-driver fades never finish under jest.
 */

jest.mock("expo", () => {
  const actual = jest.requireActual("expo")
  return {
    ...actual,
    // A live subscription, so `isPlaying` follows the fake player's events.
    useEvent: (
      player: {
        addListener: (
          n: string,
          f: (p?: unknown) => void,
        ) => { remove: () => void }
      },
      event: string,
      initial: unknown,
    ) => {
      const r = require as unknown as NodeRequireLike
      const react = r("react") as {
        useState: <T>(v: T) => [T, (v: T) => void]
        useEffect: (fn: () => () => void, deps: unknown[]) => void
      }
      const [value, setValue] = react.useState(initial)
      react.useEffect(() => {
        const sub = player.addListener(event, (payload) =>
          setValue(payload as never),
        )
        return () => sub.remove()
      }, [player, event])
      return value
    },
  }
})

import { StrictMode, act } from "react"
import { AccessibilityInfo, Animated, AppState } from "react-native"
import type { VideoPlayer } from "expo-video"

import {
  useControlsGlassVisible,
  useControlsVisibility,
  type ControlsVisibility,
} from "../useControlsVisibility"
import { makeFakePlayer, type FakePlayer } from "../../test-utils/expoVideoMock"
import {
  TestRenderer,
  type NodeRequireLike,
  type TestInstance,
} from "../../test-utils/rnTestRenderer"

type FadeRun = {
  toValue: number
  done?: (result: { finished: boolean }) => void
  stopped: boolean
}

let fades: FadeRun[]
let appStateListeners: Array<(state: string) => void>
let latest: ControlsVisibility | null
let hostRenders: number
let glassSeen: boolean[]
let mountedRenderer: TestInstance | null

function fakeAnimatedTiming() {
  jest.spyOn(Animated, "timing").mockImplementation((_value, config) => {
    const run: FadeRun = {
      toValue: (config as { toValue: number }).toValue,
      stopped: false,
    }
    fades.push(run)
    return {
      start: (done?: (result: { finished: boolean }) => void) => {
        run.done = done
      },
      // As on a device: a stopped animation reports finished: false.
      stop: () => {
        if (run.stopped) return
        run.stopped = true
        run.done?.({ finished: false })
      },
      reset: () => {},
    } as Animated.CompositeAnimation
  })
}

function captureAppState() {
  jest
    .spyOn(AppState, "addEventListener")
    .mockImplementation((type: string, handler: unknown) => {
      expect(type).toBe("change")
      const listener = handler as (state: string) => void
      appStateListeners.push(listener)
      return {
        remove: () => {
          appStateListeners = appStateListeners.filter((l) => l !== listener)
        },
      } as ReturnType<typeof AppState.addEventListener>
    })
}

function Glass({ store }: { store: ControlsVisibility["visibleStore"] }) {
  glassSeen.push(useControlsGlassVisible(store))
  return null
}

function Host({ player }: { player: FakePlayer }) {
  const api = useControlsVisibility(player as unknown as VideoPlayer)
  latest = api
  hostRenders += 1
  return <Glass store={api.visibleStore} />
}

async function render(opts: { strict?: boolean } = {}) {
  const player = makeFakePlayer()
  const element = <Host player={player} />
  await act(async () => {
    mountedRenderer = TestRenderer.create(
      opts.strict ? <StrictMode>{element}</StrictMode> : element,
    )
  })
  return { player }
}

function api(): ControlsVisibility {
  if (latest == null) throw new Error("hook not rendered")
  return latest
}

const glass = () => glassSeen[glassSeen.length - 1]

/** The native driver reports the running hide fade as finished. */
function finishHideFade() {
  const run = [...fades].reverse().find((f) => f.toValue === 0 && !f.stopped)
  if (run?.done == null) throw new Error("no running hide fade")
  const done = run.done
  act(() => done({ finished: true }))
}

function hideFadeCount() {
  return fades.filter((f) => f.toValue === 0).length
}

beforeEach(() => {
  jest.useFakeTimers()
  fades = []
  appStateListeners = []
  latest = null
  hostRenders = 0
  glassSeen = []
  mountedRenderer = null
  fakeAnimatedTiming()
  captureAppState()
  // The preset's mock is shared across cases, so pin the default each time.
  jest
    .spyOn(AccessibilityInfo, "isReduceMotionEnabled")
    .mockResolvedValue(false)
})

afterEach(() => {
  // Unmount even after a failed case, or its hook keeps writing `latest`.
  const renderer = mountedRenderer
  if (renderer != null) act(() => renderer.unmount())
  jest.useRealTimers()
  jest.restoreAllMocks()
})

describe("useControlsVisibility — the published glass value (KTD5)", () => {
  it("starts shown, with the glass value true", async () => {
    await render()
    expect(api().mounted).toBe(true)
    expect(api().visibleStore.get()).toBe(true)
    expect(glass()).toBe(true)
  })

  it("publishes false at hide start, while the chrome stays mounted and the host does not re-render", async () => {
    await render()
    const heard = jest.fn(() => api().visibleStore.get())
    api().visibleStore.subscribe(heard)
    const rendersBefore = hostRenders

    act(() => api().hide())

    expect(heard).toHaveReturnedWith(false)
    expect(api().visibleStore.get()).toBe(false)
    expect(api().isVisibleNow()).toBe(false)
    expect(glass()).toBe(false)
    // The fade is still running: the chrome stays up so a tap can reveal it.
    expect(api().mounted).toBe(true)
    expect(hostRenders).toBe(rendersBefore)
  })

  it("publishes false when the idle timer starts the hide", async () => {
    const { player } = await render()
    // Past the mount fallback, which re-arms the idle timer from scratch.
    act(() => jest.advanceTimersByTime(2000))
    act(() => {
      player.__emit("statusChange", { status: "readyToPlay" })
      player.play()
    })
    expect(api().visibleStore.get()).toBe(true)

    act(() => jest.advanceTimersByTime(3000))

    expect(api().visibleStore.get()).toBe(false)
    expect(glass()).toBe(false)
    expect(api().mounted).toBe(true)
  })

  it("unmounts the chrome when the hide fade finishes, and keeps the value false", async () => {
    await render()
    act(() => api().hide())

    finishHideFade()

    expect(api().mounted).toBe(false)
    expect(api().controlsVisible).toBe(false)
    expect(api().visibleStore.get()).toBe(false)
    expect(glass()).toBe(false)
  })

  it.each([
    ["a reveal", (c: ControlsVisibility) => c.revealIfHidden()],
    ["a control interaction", (c: ControlsVisibility) => c.noteInteraction()],
  ])(
    "%s during the fade publishes true and keeps the chrome mounted",
    async (_label, bringBack) => {
      await render()
      act(() => api().hide())
      expect(api().visibleStore.get()).toBe(false)

      act(() => bringBack(api()))

      expect(api().visibleStore.get()).toBe(true)
      expect(glass()).toBe(true)
      expect(api().mounted).toBe(true)
      expect(api().controlsVisible).toBe(true)
      // The interrupted fade reported finished: false, so nothing unmounts.
      expect(fades.find((f) => f.toValue === 0)?.stopped).toBe(true)
    },
  )

  it("shows the chrome with the glass value true on an AppState 'active' event after it unmounted (AE1)", async () => {
    await render()
    act(() => api().hide())
    finishHideFade()
    expect(api().mounted).toBe(false)

    act(() => appStateListeners.forEach((l) => l("active")))

    expect(api().mounted).toBe(true)
    expect(api().controlsVisible).toBe(true)
    expect(api().visibleStore.get()).toBe(true)
    expect(glass()).toBe(true)
  })

  it("under Reduce Motion, a hide snaps to unmounted with the value false in one step", async () => {
    jest
      .spyOn(AccessibilityInfo, "isReduceMotionEnabled")
      .mockResolvedValue(true)
    await render()

    act(() => api().hide())

    expect(hideFadeCount()).toBe(0)
    expect(api().mounted).toBe(false)
    expect(api().controlsVisible).toBe(false)
    expect(api().visibleStore.get()).toBe(false)
    expect(glass()).toBe(false)
  })

  it("still hides, reveals and answers AppState after StrictMode's double effect cycle", async () => {
    await render({ strict: true })
    // The first setup's listener was removed by its cleanup.
    expect(appStateListeners).toHaveLength(1)

    act(() => api().hide())
    expect(api().visibleStore.get()).toBe(false)
    act(() => api().revealIfHidden())
    expect(api().visibleStore.get()).toBe(true)

    act(() => api().hide())
    finishHideFade()
    expect(api().mounted).toBe(false)

    act(() => appStateListeners.forEach((l) => l("active")))

    expect(api().mounted).toBe(true)
    expect(api().visibleStore.get()).toBe(true)
    expect(glass()).toBe(true)
  })
})
