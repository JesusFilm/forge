// The pause countdown (U10, KTD9, R16, R17, R26). The hook cases wrap the probe
// in StrictMode (RTL is not installed here) and drive AppState through a spy.
import { StrictMode, act, createElement } from "react"
import { AppState, type AppStateStatus } from "react-native"

import {
  TestRenderer,
  unmount,
  type TestInstance,
} from "../../../test-utils/rnTestRenderer"
import {
  formatClock,
  spokenTimeLeft,
  useCountdown,
  type Countdown,
} from "../countdown"

describe("formatClock", () => {
  it.each([
    [20, "0:20"],
    [45, "0:45"],
    [90, "1:30"],
    [15, "0:15"],
    [60, "1:00"],
    [9, "0:09"],
    [0, "0:00"],
  ])("writes %i seconds as %s", (seconds, text) => {
    expect(formatClock(seconds)).toBe(text)
  })
})

describe("spokenTimeLeft", () => {
  it.each([
    [90, "1 minute 30 seconds left"],
    [60, "1 minute left"],
    [45, "45 seconds left"],
    [1, "1 second left"],
  ])("says %i seconds as %s", (seconds, text) => {
    expect(spokenTimeLeft(seconds)).toBe(text)
  })
})

describe("useCountdown", () => {
  const seen: Countdown[] = []
  let handlers: ((state: AppStateStatus) => void)[] = []
  let renderer: TestInstance | null = null

  function Probe({
    totalSec,
    started,
  }: {
    totalSec: number
    started?: boolean
  }) {
    seen.push(useCountdown(totalSec, started))
    return null
  }

  function probe(totalSec: number, started?: boolean) {
    return createElement(
      StrictMode,
      null,
      createElement(Probe, { totalSec, started }),
    )
  }

  async function mount(totalSec: number, started?: boolean) {
    await act(async () => {
      renderer = TestRenderer.create(probe(totalSec, started))
    })
  }

  async function start(totalSec: number) {
    await act(async () => {
      renderer!.update(probe(totalSec, true))
    })
  }

  const latest = () => seen.at(-1)!

  /** Small steps, so React commits between timers as it does on a phone. */
  function advance(ms: number) {
    for (let left = ms; left > 0; left -= 250) {
      act(() => {
        jest.advanceTimersByTime(Math.min(250, left))
      })
    }
  }

  function appState(state: AppStateStatus) {
    act(() => {
      for (const handler of [...handlers]) handler(state)
    })
  }

  beforeEach(() => {
    jest.useFakeTimers({ now: new Date(2026, 9, 5, 7, 0) })
    handlers = []
    jest.spyOn(AppState, "addEventListener").mockImplementation(((
      _event: string,
      handler: (state: AppStateStatus) => void,
    ) => {
      handlers.push(handler)
      return {
        remove: () => {
          handlers = handlers.filter((one) => one !== handler)
        },
      }
    }) as never)
  })

  afterEach(async () => {
    if (renderer) await unmount(renderer)
    renderer = null
    seen.length = 0
    jest.restoreAllMocks()
    jest.useRealTimers()
  })

  it("starts at the full time and runs", async () => {
    await mount(45)
    expect(latest()).toMatchObject({
      totalMs: 45_000,
      msLeft: 45_000,
      secondsLeft: 45,
      running: true,
      done: false,
    })
  })

  it("counts down one second at a time", async () => {
    await mount(45)
    advance(999)
    expect(latest().secondsLeft).toBe(45)
    advance(1)
    expect(latest().secondsLeft).toBe(44)
    advance(14_000)
    expect(latest().secondsLeft).toBe(30)
    expect(latest().msLeft).toBe(30_000)
  })

  it("stops at 0:00 and stays there (AE1)", async () => {
    await mount(45)
    advance(44_000)
    expect(formatClock(latest().secondsLeft)).toBe("0:01")
    expect(latest().done).toBe(false)
    advance(1_000)
    expect(latest()).toMatchObject({
      msLeft: 0,
      secondsLeft: 0,
      running: false,
      done: true,
    })
    advance(60_000)
    expect(latest()).toMatchObject({ secondsLeft: 0, done: true })
  })

  it("holds at 0:30 in the background and continues from 0:30 on return (R26)", async () => {
    await mount(45)
    advance(15_000)
    expect(latest().secondsLeft).toBe(30)
    appState("background")
    expect(latest().running).toBe(false)
    advance(60_000)
    appState("active")
    expect(latest()).toMatchObject({
      msLeft: 30_000,
      secondsLeft: 30,
      running: true,
    })
    advance(999)
    expect(latest().secondsLeft).toBe(30)
    advance(1)
    expect(latest().secondsLeft).toBe(29)
  })

  it("gives the time left at the start of each run, for one animation per run", async () => {
    await mount(45)
    expect(latest().runFromMs).toBe(45_000)
    advance(15_000)
    expect(latest().runFromMs).toBe(45_000)
    appState("background")
    expect(latest().runFromMs).toBeNull()
    advance(60_000)
    appState("active")
    expect(latest().runFromMs).toBe(30_000)
    advance(30_000)
    expect(latest().runFromMs).toBeNull()
  })

  it("holds through a lock, which passes through inactive to background", async () => {
    await mount(30)
    advance(10_500)
    appState("inactive")
    advance(5_000)
    appState("background")
    advance(120_000)
    appState("active")
    expect(latest().msLeft).toBe(19_500)
    expect(latest().secondsLeft).toBe(20)
  })

  it("holds from the start when it mounts while the app is not active", async () => {
    const before = AppState.currentState
    AppState.currentState = "background"
    try {
      await mount(45)
      advance(10_000)
      appState("active")
      expect(latest()).toMatchObject({ msLeft: 45_000, running: true })
      advance(1_000)
      expect(latest().secondsLeft).toBe(44)
    } finally {
      AppState.currentState = before
    }
  })

  // The Reflect and Pray screens start their timer after the intro (the
  // owner, 2026-10-06), so the intro takes no time from the pause.
  it("holds at the full time until it starts, then counts from the full time", async () => {
    await mount(45, false)
    expect(latest()).toMatchObject({
      msLeft: 45_000,
      running: false,
      runFromMs: null,
      done: false,
    })
    advance(5_000)
    expect(latest().msLeft).toBe(45_000)
    // A return from the background before the start does not start it.
    appState("background")
    appState("active")
    advance(1_000)
    expect(latest()).toMatchObject({ msLeft: 45_000, running: false })

    await start(45)
    expect(latest()).toMatchObject({
      msLeft: 45_000,
      running: true,
      runFromMs: 45_000,
    })
    advance(1_000)
    expect(latest().secondsLeft).toBe(44)
  })

  it("waits for the return when it starts while the app is away", async () => {
    await mount(45, false)
    appState("background")
    const before = AppState.currentState
    AppState.currentState = "background"
    try {
      await start(45)
      advance(10_000)
      expect(latest()).toMatchObject({ msLeft: 45_000, running: false })
      appState("active")
      expect(latest()).toMatchObject({ msLeft: 45_000, running: true })
    } finally {
      AppState.currentState = before
    }
  })
})
