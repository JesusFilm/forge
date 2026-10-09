// The run (U8, R5, R6, R10, KTD4, KTD11). The reducer cases are pure. The hook
// cases write a real day record over fake storage, and wrap the element in
// StrictMode (RTL is not installed here).
import { StrictMode, act, createElement } from "react"

import {
  TestRenderer,
  unmount,
  type TestInstance,
} from "../../../test-utils/rnTestRenderer"
import {
  PAUSE_DAY_STORAGE_KEY,
  PAUSE_DAY_VERSION,
  PAUSE_STEPS,
  createPauseProgressStore,
  dayFromRecord,
  resumeTarget,
  usePauseDay,
  type PauseProgressStore,
  type PauseStep,
} from "../progress"
import {
  RUN_START,
  isVideoPart,
  runReducer,
  sectionForStep,
  useDailyPauseRun,
  type DailyPauseRun,
  type RunState,
} from "../run"
import { devotionalForDay, useToday, type Today } from "../today"

const MONDAY_KEY = "2026-10-05"
const TUESDAY_KEY = "2026-10-06"
const MONDAY: Today = {
  dayKey: MONDAY_KEY,
  devotional: devotionalForDay(MONDAY_KEY),
}

function makeStorage(seed?: Record<string, unknown>) {
  const items = new Map<string, string>()
  if (seed) {
    items.set(
      PAUSE_DAY_STORAGE_KEY,
      JSON.stringify({ version: PAUSE_DAY_VERSION, ...seed }),
    )
  }
  return {
    items,
    getItem: jest.fn(async (key: string) => items.get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => {
      items.set(key, value)
    }),
  }
}

async function settle() {
  for (let i = 0; i < 8; i += 1) await Promise.resolve()
}

describe("runReducer (R10)", () => {
  function walk(from: RunState): PauseStep[] {
    const seen: PauseStep[] = []
    let state = from
    for (let i = 0; i < 6; i += 1) {
      state = runReducer(state, { type: "advance" })
      seen.push(state.step)
    }
    return seen
  }

  it("starts at the Opening with no pinned day", () => {
    expect(RUN_START).toEqual({ step: "opening", pin: null })
  })

  it("begins at the Watch screen and pins today", () => {
    expect(runReducer(RUN_START, { type: "begin", today: MONDAY })).toEqual({
      step: "watchScreen",
      pin: MONDAY,
    })
  })

  it("walks the R10 order to Share, and an advance at Share does nothing", () => {
    const begun = runReducer(RUN_START, { type: "begin", today: MONDAY })
    expect(walk(begun)).toEqual([
      "film",
      "teaching",
      "reflectScreen",
      "prayer",
      "prayScreen",
      "share",
    ])
    const share: RunState = { step: "share", pin: MONDAY }
    expect(runReducer(share, { type: "advance" })).toBe(share)
  })

  it("resumes at the saved step and pins today (AE2)", () => {
    expect(
      runReducer(RUN_START, { type: "resume", today: MONDAY, step: "prayer" }),
    ).toEqual({ step: "prayer", pin: MONDAY })
  })

  it("starts over at the Watch screen", () => {
    expect(runReducer(RUN_START, { type: "startOver", today: MONDAY })).toEqual(
      { step: "watchScreen", pin: MONDAY },
    )
  })

  it("goes back to the Opening and drops the pinned day on a reset", () => {
    const reflecting: RunState = { step: "reflectScreen", pin: MONDAY }
    expect(runReducer(reflecting, { type: "reset" })).toBe(RUN_START)
  })
})

// v2 plan R1, R3, KTD4: each video part belongs to one section, and the
// step order stays the same.
describe("sectionForStep (v2 plan R3)", () => {
  it("maps the film to Watch, the teaching to Reflect, and the prayer to Pray", () => {
    expect(sectionForStep("film")).toBe("watch")
    expect(sectionForStep("teaching")).toBe("reflect")
    expect(sectionForStep("prayer")).toBe("pray")
  })

  it("gives a section on the video parts only", () => {
    for (const step of PAUSE_STEPS) {
      expect(sectionForStep(step) != null).toBe(isVideoPart(step))
    }
  })
})

describe("useDailyPauseRun with the day record (KTD11)", () => {
  let run: DailyPauseRun
  let renderer: TestInstance | null = null
  /** Each step write that reached the record, in order. */
  let writes: [string, PauseStep][] = []

  /** The real store; the wrapper only logs the step writes. */
  function logged(store: PauseProgressStore): PauseProgressStore {
    return {
      ...store,
      recordStep: (dayKey, step) => {
        writes.push([dayKey, step])
        store.recordStep(dayKey, step)
      },
    }
  }

  // The probe reads the day as the run screen does, so each write that
  // changes the record also renders the probe again.
  async function mount(store: PauseProgressStore) {
    function Probe() {
      usePauseDay(MONDAY_KEY, store)
      run = useDailyPauseRun(store)
      return null
    }
    await act(async () => {
      renderer = TestRenderer.create(
        createElement(StrictMode, null, createElement(Probe)),
      )
    })
  }

  async function close() {
    if (renderer) await unmount(renderer)
    renderer = null
  }

  async function step(action: (current: DailyPauseRun) => void) {
    await act(async () => action(run))
    await settle()
  }

  beforeEach(() => {
    writes = []
  })

  afterEach(async () => {
    await close()
    jest.useRealTimers()
  })

  it("resumes at the prayer part after a close during the prayer part (AE2)", async () => {
    const storage = makeStorage()
    const store = createPauseProgressStore(storage)
    await store.hydrate()
    await mount(store)
    await step((r) => r.begin(MONDAY))
    for (let i = 0; i < 4; i += 1) await step((r) => r.advance())
    expect(run.state.step).toBe("prayer")
    await close()

    const relaunched = createPauseProgressStore(storage)
    await relaunched.hydrate()
    const target = resumeTarget(
      dayFromRecord(relaunched.getSnapshot(), MONDAY_KEY),
    )
    expect(target).toBe("prayer")
    await mount(relaunched)
    await step((r) => r.resume(MONDAY, target!))
    expect(run.state).toEqual({ step: "prayer", pin: MONDAY })
  })

  it("starts over at the Watch screen and replaces the saved step", async () => {
    const storage = makeStorage({ dayKey: MONDAY_KEY, step: "prayer" })
    const store = createPauseProgressStore(storage)
    await store.hydrate()
    await mount(store)
    await step((r) => r.startOver(MONDAY))
    expect(run.state.step).toBe("watchScreen")
    expect(dayFromRecord(store.getSnapshot(), MONDAY_KEY).step).toBe(
      "watchScreen",
    )
  })

  it("begins again on a done day at the Watch screen, and the day stays done", async () => {
    const storage = makeStorage({
      dayKey: MONDAY_KEY,
      step: "share",
      done: true,
    })
    const store = createPauseProgressStore(storage)
    await store.hydrate()
    await mount(store)
    await step((r) => r.begin(MONDAY))
    expect(run.state.step).toBe("watchScreen")
    expect(dayFromRecord(store.getSnapshot(), MONDAY_KEY)).toMatchObject({
      step: "watchScreen",
      done: true,
    })
  })

  it("keeps its devotional across local midnight and writes its own day", async () => {
    jest.useFakeTimers({ now: new Date(2026, 9, 5, 23, 59, 30) })
    const storage = makeStorage()
    const store = createPauseProgressStore(storage)
    await store.hydrate()
    let today: Today | null = null
    function Probe() {
      today = useToday()
      run = useDailyPauseRun(store)
      return null
    }
    await act(async () => {
      renderer = TestRenderer.create(
        createElement(StrictMode, null, createElement(Probe)),
      )
    })
    await step((r) => r.begin(today!))
    await act(async () => {
      jest.advanceTimersByTime(60_000)
    })
    expect(today!.dayKey).toBe(TUESDAY_KEY)

    await step((r) => r.advance())
    expect(run.state).toEqual({ step: "film", pin: MONDAY })
    expect(store.getSnapshot()).toMatchObject({
      dayKey: MONDAY_KEY,
      step: "film",
    })
    expect(dayFromRecord(store.getSnapshot(), TUESDAY_KEY).step).toBeNull()
  })

  it("writes each step once under StrictMode, and nothing at the Opening", async () => {
    const store = createPauseProgressStore(makeStorage())
    await store.hydrate()
    await mount(logged(store))
    expect(writes).toEqual([])
    await step((r) => r.begin(MONDAY))
    await step((r) => r.advance())
    await step((r) => r.advance())
    expect(writes).toEqual([
      [MONDAY_KEY, "watchScreen"],
      [MONDAY_KEY, "film"],
      [MONDAY_KEY, "teaching"],
    ])
  })
})
