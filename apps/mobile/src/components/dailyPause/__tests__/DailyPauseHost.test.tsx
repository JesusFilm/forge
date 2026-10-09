/**
 * The curtain handover against the REAL curtain store, stage, mini player
 * store, day record, and search intent store. Only the router, the experience
 * selection, and the native animation driver are modelled.
 */

import { StrictMode, act, type ReactElement } from "react"
import { Animated, BackHandler, Pressable, Text } from "react-native"

import {
  dayFromRecord,
  getPauseProgressStore,
  resetPauseProgressStoreForTests,
} from "../../../lib/dailyPause/progress"
import { localDay } from "../../../lib/dailyPause/today"
import {
  getMiniPlayerStore,
  type MiniPlayerEndEvent,
} from "../../../lib/miniPlayer/store"
import {
  endPause,
  getPausePhase,
  liftPause,
  reportLogoDrawn,
  requestPause,
  requestPauseExit,
  setPauseRunOnTop,
  type PauseExitTarget,
} from "../../../lib/pauseCurtain"
import {
  resetPlaybackTransportForTests,
  setPlaybackTransport,
} from "../../../lib/playbackInterruption"
import { getSearchIntentStore } from "../../../lib/searchIntent"
import {
  TestRenderer,
  press,
  pressableByLabel,
  unmount,
  type NodePath,
  type NodeRequireLike,
  type TestInstance,
} from "../../../test-utils/rnTestRenderer"
import { PAUSE_LOGO_DRAWN_MS, PauseStage } from "../../PauseStage"
import {
  DailyPauseHost,
  PAUSE_EXIT_BACKSTOP_MS,
  PAUSE_HANDOVER_DEADLINE_MS,
  useCloseDailyPause,
} from "../DailyPauseHost"

/* eslint-disable @typescript-eslint/no-require-imports */
jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock"),
)
/* eslint-enable @typescript-eslint/no-require-imports */

const mockRouter = {
  push: jest.fn(),
  replace: jest.fn(),
  navigate: jest.fn(),
  dismissTo: jest.fn(),
}
let mockSegments: string[] = ["(tabs)"]
jest.mock("expo-router", () => ({
  useRouter: () => mockRouter,
  useSegments: () => mockSegments,
}))

let mockSelection: { isReady: boolean; currentSlug: string | null } = {
  isReady: true,
  currentSlug: "jesus-film",
}
jest.mock("../../../contexts/ExperienceSelectionProvider", () => ({
  useExperienceSelection: () => mockSelection,
}))
jest.mock("expo-status-bar", () => ({ setStatusBarHidden: () => {} }))
jest.mock("expo-linear-gradient", () => ({ LinearGradient: () => null }))

const CURTAIN_LABEL = "Daily Bible Pause. Tap to return."
const EXIT_LABEL = "Daily Bible Pause. Leaving the devotional."
const READY = { isReady: true, currentSlug: "jesus-film" }
const QUESTION = "How are we commanded to pray?"
/** The event that a put on the search intent store logs. */
const INTENT = `intent ${QUESTION}`

// ── The native animation driver and Android back, modelled ─────────

type Timing = { toValue: number; finish: () => void }
let timings: Timing[] = []
let backHandlers: Array<() => boolean> = []
/** What the viewer would see, in order: the route changes and the lift. */
let events: string[] = []

const lift = () => timings.find((t) => t.toValue === 0)!

// ── The root player and the mini player ─────────────────────────────

const sessions = getMiniPlayerStore()
let rootPlaying = false
const transport = {
  isPlaying: () => rootPlaying,
  pause: () => {
    rootPlaying = false
  },
  play: () => {
    rootPlaying = true
  },
}
const mounted: TestInstance[] = []
let ends: MiniPlayerEndEvent[] = []
let stopEnds: () => void = () => {}
const intents = getSearchIntentStore()
let stopIntents: () => void = () => {}

function floatingWindow() {
  sessions.start({
    videoId: "video-1",
    videoSlug: "birth-of-jesus",
    title: "Birth of Jesus",
    originPattern: "watch/[slug]",
  })
  rootPlaying = true
}

beforeEach(() => {
  jest.useFakeTimers()
  timings = []
  backHandlers = []
  events = []
  mockSegments = ["(tabs)"]
  mockSelection = READY
  Object.values(mockRouter).forEach((fn) => fn.mockReset())
  mockRouter.push.mockImplementation(() => events.push("push"))
  mockRouter.dismissTo.mockImplementation((href: string) =>
    events.push(`dismissTo ${href}`),
  )
  jest.spyOn(Animated, "timing").mockImplementation((_value, config) => {
    let callback: Animated.EndCallback | undefined
    const toValue = config.toValue as number
    const timing = { toValue, finish: () => callback?.({ finished: true }) }
    timings.push(timing)
    return {
      start: (cb?: Animated.EndCallback) => {
        callback = cb
        if (toValue === 0) events.push("lift")
      },
      stop: () => {},
      reset: () => {},
    } as unknown as Animated.CompositeAnimation
  })
  jest
    .spyOn(BackHandler, "addEventListener")
    .mockImplementation((_, handler) => {
      const fn = handler as unknown as () => boolean
      backHandlers.push(fn)
      return {
        remove: () => {
          backHandlers = backHandlers.filter((other) => other !== fn)
        },
      }
    })

  sessions.setPipHold(false)
  sessions.end("abandoned")
  ends = []
  stopEnds = sessions.onEnd((event) => ends.push(event))
  rootPlaying = false
  resetPlaybackTransportForTests()
  setPlaybackTransport(transport)
  resetPauseProgressStoreForTests()
  intents.clear()
  stopIntents = intents.subscribe(() => {
    const intent = intents.peek()
    if (intent != null) events.push(`intent ${intent.query}`)
  })
})

afterEach(() => {
  // A failed test skips its own unmount, and a live host would act in the next.
  mounted.splice(0).forEach((renderer) => act(() => renderer.unmount()))
  act(() => endPause())
  setPauseRunOnTop(false)
  stopEnds()
  stopIntents()
  intents.clear()
  jest.restoreAllMocks()
  jest.useRealTimers()
})

function tree(strict = false): ReactElement {
  const app = (
    <PauseStage>
      <Text>Home</Text>
      <DailyPauseHost />
    </PauseStage>
  )
  return (strict ? <StrictMode>{app}</StrictMode> : app) as ReactElement
}

async function render(strict = false): Promise<TestInstance> {
  let renderer!: TestInstance
  await act(async () => {
    renderer = TestRenderer.create(tree(strict))
  })
  mounted.push(renderer)
  return renderer
}

async function advance(ms: number) {
  await act(async () => {
    jest.advanceTimersByTime(ms)
  })
}

async function enter() {
  await act(async () => requestPause())
}

async function leave(target: PauseExitTarget) {
  await act(async () => requestPauseExit(target))
}

/** The router moves: the host renders again with the new segments. */
async function showSegments(
  renderer: TestInstance,
  segments: string[],
  strict = false,
) {
  mockSegments = segments
  await act(async () => renderer.update(tree(strict)))
}

/** React Native asks the last-added back listener first, then the next. */
function pressBack(): boolean {
  return [...backHandlers].reverse().some((handler) => handler())
}

function bellRead(): boolean {
  const today = localDay(new Date())
  return dayFromRecord(getPauseProgressStore().getSnapshot(), today).bellRead
}

function curtainCount(renderer: TestInstance): number {
  return renderer.root.findAll(
    (node) =>
      node.props.accessibilityLabel === CURTAIN_LABEL &&
      typeof node.props.onPress === "function",
  ).length
}

describe("the curtain handover (KTD5)", () => {
  it("pushes the run once when the pen ends with the selection ready, then lifts", async () => {
    const renderer = await render()
    await enter()
    await advance(PAUSE_LOGO_DRAWN_MS - 1)
    expect(mockRouter.push).not.toHaveBeenCalled()
    await advance(1)
    expect(mockRouter.push).toHaveBeenCalledTimes(1)
    expect(mockRouter.push).toHaveBeenCalledWith("/pause")
    expect(events).toEqual(["push", "lift"])
    await act(async () => lift().finish())
    expect(curtainCount(renderer)).toBe(0)
    await unmount(renderer)
  })

  it("waits for the selection, and pushes when the deadline passes", async () => {
    mockSelection = { isReady: false, currentSlug: null }
    const renderer = await render()
    await enter()
    await advance(PAUSE_LOGO_DRAWN_MS)
    await advance(PAUSE_HANDOVER_DEADLINE_MS - 1)
    expect(mockRouter.push).not.toHaveBeenCalled()
    expect(getPausePhase()).toBe("drawn")
    await advance(1)
    expect(mockRouter.push).toHaveBeenCalledTimes(1)
    expect(events).toEqual(["push", "lift"])
    await unmount(renderer)
  })

  // A ready selection with no slug still waits: the shell resolves the
  // homepage next, and that swap remounts the stack.
  it("pushes as soon as the selection has its slug", async () => {
    mockSelection = { isReady: true, currentSlug: null }
    const renderer = await render()
    await enter()
    await advance(PAUSE_LOGO_DRAWN_MS + 500)
    expect(mockRouter.push).not.toHaveBeenCalled()
    mockSelection = READY
    await act(async () => renderer.update(tree()))
    expect(mockRouter.push).toHaveBeenCalledTimes(1)
    await advance(PAUSE_HANDOVER_DEADLINE_MS)
    expect(mockRouter.push).toHaveBeenCalledTimes(1)
    await unmount(renderer)
  })

  it("pushes nothing after a curtain tap before the pen ends, and lifts back", async () => {
    const renderer = await render()
    await enter()
    await advance(1000)
    await press(pressableByLabel(renderer, CURTAIN_LABEL))
    expect(events).toEqual(["lift"])
    await advance(PAUSE_LOGO_DRAWN_MS + PAUSE_HANDOVER_DEADLINE_MS)
    expect(mockRouter.push).not.toHaveBeenCalled()
    await act(async () => lift().finish())
    expect(curtainCount(renderer)).toBe(0)
    expect(getPausePhase()).toBe("idle")
    await unmount(renderer)
  })

  it.each([[["pause"]], [["pause", "customize"]]])(
    "does nothing for a new request while %j is on top",
    async (segments) => {
      mockSegments = segments
      const renderer = await render()
      await enter()
      expect(curtainCount(renderer)).toBe(0)
      expect(timings).toHaveLength(0)
      await advance(PAUSE_LOGO_DRAWN_MS + PAUSE_HANDOVER_DEADLINE_MS)
      expect(mockRouter.push).not.toHaveBeenCalled()
      await unmount(renderer)
    },
  )

  it("pushes once for one entry under StrictMode", async () => {
    const renderer = await render(true)
    await enter()
    await advance(PAUSE_LOGO_DRAWN_MS + PAUSE_HANDOVER_DEADLINE_MS)
    expect(mockRouter.push).toHaveBeenCalledTimes(1)
    await unmount(renderer)
  })

  it("marks today's devotional opened, which clears the bell's dot (R2)", async () => {
    const renderer = await render()
    await enter()
    await advance(PAUSE_LOGO_DRAWN_MS)
    await act(async () => {
      await getPauseProgressStore().hydrate()
    })
    const today = localDay(new Date())
    expect(
      dayFromRecord(getPauseProgressStore().getSnapshot(), today).bellRead,
    ).toBe(true)
    await unmount(renderer)
  })
})

describe("the takeover at entry (KTD6, R46)", () => {
  it("ends a floating mini player session as dismissed", async () => {
    floatingWindow()
    const renderer = await render()
    await enter()
    await advance(PAUSE_LOGO_DRAWN_MS)
    expect(sessions.getSnapshot().dismissal).toBe("exiting")
    expect(ends.map((event) => event.reason)).toEqual(["dismissed"])
    await unmount(renderer)
  })

  it("pauses the root player under a picture-in-picture hold", async () => {
    floatingWindow()
    sessions.setPipHold(true)
    const renderer = await render()
    await enter()
    await advance(PAUSE_LOGO_DRAWN_MS)
    expect(rootPlaying).toBe(false)
    expect(sessions.getSnapshot().dismissal).toBe("none")
    expect(ends).toEqual([])
    await unmount(renderer)
  })

  it("leaves the video alone when a curtain tap cancels the entry", async () => {
    floatingWindow()
    const renderer = await render()
    await enter()
    await advance(1000)
    await press(pressableByLabel(renderer, CURTAIN_LABEL))
    await advance(PAUSE_LOGO_DRAWN_MS + PAUSE_HANDOVER_DEADLINE_MS)
    expect(sessions.getSnapshot().dismissal).toBe("none")
    expect(rootPlaying).toBe(true)
    await unmount(renderer)
  })
})

// v2 R17, R18, KTD5: Share's two exits close the curtain over the run, pop
// to their target under it, and lift once the target shows.
describe("the exit", () => {
  it("pops to Home when drawn, lifts only when Home shows, and leaves the player and the bell alone", async () => {
    mockSegments = ["pause"]
    floatingWindow()
    const renderer = await render()
    await leave({ kind: "home" })
    await advance(PAUSE_LOGO_DRAWN_MS - 1)
    expect(events).toEqual([])
    await advance(1)
    expect(events).toEqual(["dismissTo /(tabs)"])
    await advance(PAUSE_EXIT_BACKSTOP_MS - 1)
    expect(events).toEqual(["dismissTo /(tabs)"])

    await showSegments(renderer, ["(tabs)"])
    expect(events).toEqual(["dismissTo /(tabs)", "lift"])
    expect(mockRouter.push).not.toHaveBeenCalled()
    expect(mockRouter.navigate).not.toHaveBeenCalled()
    expect(mockRouter.replace).not.toHaveBeenCalled()
    expect(sessions.getSnapshot().dismissal).toBe("none")
    expect(ends).toEqual([])
    expect(rootPlaying).toBe(true)
    await act(async () => {
      await getPauseProgressStore().hydrate()
    })
    expect(bellRead()).toBe(false)
    expect(intents.peek()).toBeNull()
    await act(async () => lift().finish())
    expect(getPausePhase()).toBe("idle")
    await unmount(renderer)
  })

  it("pops to the search tab without waiting for the selection, and lifts only when that tab shows", async () => {
    mockSegments = ["pause"]
    mockSelection = { isReady: false, currentSlug: null }
    const renderer = await render()
    await leave({ kind: "search", question: QUESTION })
    await advance(PAUSE_LOGO_DRAWN_MS)
    expect(events).toEqual([INTENT, "dismissTo /(tabs)/watch"])
    // iOS native tabs can show Home for one render before the search tab.
    await showSegments(renderer, ["(tabs)"])
    expect(events).toEqual([INTENT, "dismissTo /(tabs)/watch"])
    await showSegments(renderer, ["(tabs)", "watch"])
    expect(events).toEqual([INTENT, "dismissTo /(tabs)/watch", "lift"])
    await advance(PAUSE_HANDOVER_DEADLINE_MS)
    expect(mockRouter.push).not.toHaveBeenCalled()
    await unmount(renderer)
  })

  // AE8: the viewer chose to leave, so a tap does not stop the exit.
  it("goes on to its target after a tap on the closing curtain", async () => {
    mockSegments = ["pause"]
    const renderer = await render()
    await leave({ kind: "home" })
    await advance(1000)
    const curtain = renderer.root.findAll(
      (node) => node.props.accessibilityLabel === EXIT_LABEL,
    )
    expect(curtain.length).toBeGreaterThan(0)
    for (const node of curtain) await press(node)
    expect(events).toEqual([])
    expect(getPausePhase()).toBe("closing")
    await advance(PAUSE_LOGO_DRAWN_MS - 1000)
    expect(events).toEqual(["dismissTo /(tabs)"])
    await showSegments(renderer, ["(tabs)"])
    expect(events).toEqual(["dismissTo /(tabs)", "lift"])
    await unmount(renderer)
  })

  it("neither lifts nor closes the run on Android back", async () => {
    mockSegments = ["pause"]
    const renderer = await render()
    await leave({ kind: "search", question: QUESTION })
    let consumed = false
    await act(async () => {
      consumed = pressBack()
    })
    expect(consumed).toBe(true)
    expect(events).toEqual([])
    expect(getPausePhase()).toBe("closing")
    await advance(PAUSE_LOGO_DRAWN_MS)
    expect(events).toEqual([INTENT, "dismissTo /(tabs)/watch"])
    await unmount(renderer)
  })

  it("lifts on the backstop when the segments never show the target", async () => {
    mockSegments = ["pause"]
    const renderer = await render()
    await leave({ kind: "search", question: QUESTION })
    await advance(PAUSE_LOGO_DRAWN_MS)
    await advance(PAUSE_EXIT_BACKSTOP_MS - 1)
    expect(events).toEqual([INTENT, "dismissTo /(tabs)/watch"])
    await advance(1)
    expect(events).toEqual([INTENT, "dismissTo /(tabs)/watch", "lift"])
    await act(async () => lift().finish())
    expect(getPausePhase()).toBe("idle")
    await unmount(renderer)
  })

  // AE6, KTD6: the put comes at drawn, before the pop, so a long time in the
  // background before the logo is drawn cannot expire it.
  it("puts the question before it pops to the search tab, and the tab can read it after the lift (AE6)", async () => {
    mockSegments = ["pause"]
    const renderer = await render()
    await leave({ kind: "search", question: QUESTION })
    await advance(PAUSE_LOGO_DRAWN_MS - 1)
    expect(events).toEqual([])
    expect(intents.peek()).toBeNull()
    await advance(1)
    expect(events).toEqual([INTENT, "dismissTo /(tabs)/watch"])
    await showSegments(renderer, ["(tabs)", "watch"])
    expect(events).toEqual([INTENT, "dismissTo /(tabs)/watch", "lift"])
    await act(async () => lift().finish())
    expect(getPausePhase()).toBe("idle")
    expect(intents.peek()).toMatchObject({
      query: QUESTION,
      origin: "dailyPause",
    })
    await unmount(renderer)
  })

  it.each<[PauseExitTarget, string[], string[]]>([
    [{ kind: "home" }, ["(tabs)"], ["dismissTo /(tabs)", "lift"]],
    [
      { kind: "search", question: QUESTION },
      ["(tabs)", "watch"],
      [INTENT, "dismissTo /(tabs)/watch", "lift"],
    ],
  ])(
    "pops and lifts once for one exit to %j under StrictMode",
    async (target, segments, expected) => {
      mockSegments = ["pause"]
      const renderer = await render(true)
      await leave(target)
      await advance(PAUSE_LOGO_DRAWN_MS)
      await showSegments(renderer, segments, true)
      await advance(PAUSE_EXIT_BACKSTOP_MS + PAUSE_HANDOVER_DEADLINE_MS)
      expect(events).toEqual(expected)
      expect(mockRouter.push).not.toHaveBeenCalled()
      await unmount(renderer)
    },
  )
})

describe("the close (R21, R22)", () => {
  function CloseButton() {
    const close = useCloseDailyPause()
    return <Pressable accessibilityLabel="Close" onPress={close} />
  }

  it("pops to the tab navigator and selects Home", async () => {
    let renderer!: TestInstance
    await act(async () => {
      renderer = TestRenderer.create(<CloseButton />)
    })
    await press(pressableByLabel(renderer, "Close"))
    expect(mockRouter.dismissTo).toHaveBeenCalledTimes(1)
    expect(mockRouter.dismissTo).toHaveBeenCalledWith("/(tabs)")
    expect(mockRouter.push).not.toHaveBeenCalled()
    expect(mockRouter.replace).not.toHaveBeenCalled()
    expect(mockRouter.navigate).not.toHaveBeenCalled()
    await unmount(renderer)
  })

  // v2 KTD5: a screen reader can still reach the close under an exit's
  // curtain, and a close there would send a search exit to Home.
  it("does nothing while an exit's curtain is up, and closes at once when it is down", async () => {
    let renderer!: TestInstance
    await act(async () => {
      renderer = TestRenderer.create(<CloseButton />)
    })
    mounted.push(renderer)
    await act(async () =>
      requestPauseExit({ kind: "search", question: QUESTION }),
    )
    await press(pressableByLabel(renderer, "Close"))
    await act(async () => reportLogoDrawn())
    await press(pressableByLabel(renderer, "Close"))
    await act(async () => liftPause())
    await press(pressableByLabel(renderer, "Close"))
    expect(mockRouter.dismissTo).not.toHaveBeenCalled()

    await act(async () => endPause())
    await press(pressableByLabel(renderer, "Close"))
    expect(mockRouter.dismissTo).toHaveBeenCalledTimes(1)
    expect(mockRouter.dismissTo).toHaveBeenCalledWith("/(tabs)")
    await unmount(renderer)
  })

  // AE9: only Share's two new buttons take the curtain.
  it("leaves the run screen for Home at once with no curtain (AE9)", async () => {
    mockSegments = ["pause"]
    let renderer!: TestInstance
    await act(async () => {
      renderer = TestRenderer.create(
        <PauseStage>
          <CloseButton />
          <DailyPauseHost />
        </PauseStage>,
      )
    })
    mounted.push(renderer)
    await press(pressableByLabel(renderer, "Close"))
    expect(events).toEqual(["dismissTo /(tabs)"])
    expect(getPausePhase()).toBe("idle")
    expect(timings).toHaveLength(0)
    await advance(PAUSE_LOGO_DRAWN_MS + PAUSE_EXIT_BACKSTOP_MS)
    expect(events).toEqual(["dismissTo /(tabs)"])
    expect(timings).toHaveLength(0)
    await unmount(renderer)
  })

  it("closes the run on Android back from the run screen", async () => {
    mockSegments = ["pause"]
    const renderer = await render()
    expect(backHandlers).toHaveLength(1)
    let consumed = false
    await act(async () => {
      consumed = backHandlers[0]!()
    })
    expect(consumed).toBe(true)
    expect(mockRouter.dismissTo).toHaveBeenCalledWith("/(tabs)")
    await unmount(renderer)
  })

  // The customize sheet's own back closes the sheet, not the run.
  it.each([[["(tabs)"]], [["pause", "customize"]]])(
    "leaves Android back to the navigator on %j",
    async (segments) => {
      mockSegments = segments
      const renderer = await render()
      expect(backHandlers).toHaveLength(0)
      await unmount(renderer)
    },
  )
})

describe("the root layout", () => {
  const nodeRequire = require as unknown as NodeRequireLike
  const fs = nodeRequire("fs") as {
    readFileSync: (file: string, encoding: string) => string
  }
  const nodePath = nodeRequire("path") as NodePath & {
    resolve: (...parts: string[]) => string
  }
  const source = fs.readFileSync(
    nodePath.resolve(__dirname, "../../../../app/_layout.tsx"),
    "utf8",
  )

  it("requires the host inside the guarded try block, never as an import", () => {
    const required = source.indexOf(
      'require("../src/components/dailyPause/DailyPauseHost")',
    )
    expect(required).toBeGreaterThan(source.indexOf("try {"))
    expect(required).toBeLessThan(source.indexOf("} catch (e: unknown) {"))
    expect(source).not.toContain(
      'from "../src/components/dailyPause/DailyPauseHost"',
    )
  })

  // Inside the providers it reads, and outside the shell whose swap remounts.
  it("mounts the host beside the playback host, outside the experience shell", () => {
    const host = source.indexOf("<DailyPauseHost />")
    expect(host).toBeGreaterThan(source.indexOf("</ExperienceShell>"))
    expect(host).toBeGreaterThan(source.indexOf("<PlaybackHost />"))
    expect(host).toBeLessThan(source.indexOf("</SplashCoveredTree>"))
  })

  it("registers the run with no push animation and no back swipe", () => {
    const screen = source
      .split("<Stack.Screen")
      .slice(1)
      .map((segment) => segment.split("/>")[0])
      .find((segment) => segment.includes('name="pause"'))
    expect(screen).toBeDefined()
    expect(screen).toMatch(/animation:\s*"none"/)
    expect(screen).toMatch(/gestureEnabled:\s*false/)
  })
})

declare const __dirname: string
