// The day record (U5, KTD11, KTD12, R2, R5-R7). Each case has its own store and
// fake storage; a relaunch is a new store over the same storage. The hook case
// wraps the element in StrictMode (RTL is not installed here).
import { StrictMode, act, createElement } from "react"

import {
  TestRenderer,
  unmount,
  type TestInstance,
} from "../../../test-utils/rnTestRenderer"
import {
  PAUSE_DAY_STORAGE_KEY,
  PAUSE_STEPS,
  createPauseProgressStore,
  dayFromRecord,
  resumeTarget,
  usePauseDay,
  type PauseDayView,
  type PauseProgressStore,
} from "../progress"

const KEY = PAUSE_DAY_STORAGE_KEY
const MONDAY = "2026-10-05"
const TUESDAY = "2026-10-06"

function makeStorage(seed: string | null = null) {
  const items = new Map<string, string>()
  if (seed != null) items.set(KEY, seed)
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

/** A new store over the same storage, read to the end, like a relaunch. */
async function relaunch(
  storage: ReturnType<typeof makeStorage>,
): Promise<PauseProgressStore> {
  await settle()
  const store = createPauseProgressStore(storage)
  await store.hydrate()
  return store
}

function day(store: PauseProgressStore, dayKey: string) {
  return dayFromRecord(store.getSnapshot(), dayKey)
}

const EMPTY = { step: null, done: false, bellRead: false }

describe("the run steps (R10)", () => {
  it("lists the eight steps in the run order", () => {
    expect(PAUSE_STEPS).toEqual([
      "opening",
      "watchScreen",
      "film",
      "teaching",
      "reflectScreen",
      "prayer",
      "prayScreen",
      "share",
    ])
  })

  it.each(PAUSE_STEPS.map((step) => [step]))(
    "gives the Resume target for a saved %s step",
    (step) => {
      const expected = step === "opening" || step === "share" ? null : step
      expect(resumeTarget({ step, done: false, bellRead: false })).toBe(
        expected,
      )
    },
  )

  it("gives no Resume target for a day with no saved step", () => {
    expect(resumeTarget(EMPTY)).toBeNull()
  })
})

describe("the day record (KTD12)", () => {
  it("reads a recorded teaching-part step back as the Resume target (AE2)", async () => {
    const storage = makeStorage()
    const store = createPauseProgressStore(storage)
    await store.hydrate()
    store.recordStep(MONDAY, "teaching")
    expect(resumeTarget(day(store, MONDAY))).toBe("teaching")

    const next = await relaunch(storage)
    expect(resumeTarget(day(next, MONDAY))).toBe("teaching")
  })

  it("reads yesterday's record as an empty day: no Resume and not done", async () => {
    const storage = makeStorage()
    const store = createPauseProgressStore(storage)
    await store.hydrate()
    store.markBellRead(MONDAY)
    store.recordStep(MONDAY, "prayer")
    store.markDone(MONDAY)

    const next = await relaunch(storage)
    // Anti-vacuous: the record holds Monday's progress for Monday.
    expect(day(next, MONDAY)).toEqual({
      step: "prayer",
      done: true,
      bellRead: true,
    })
    expect(day(next, TUESDAY)).toEqual(EMPTY)
    expect(resumeTarget(day(next, TUESDAY))).toBeNull()
  })

  it("keeps a day done for its own key and clears it for the next", async () => {
    const storage = makeStorage()
    const store = createPauseProgressStore(storage)
    await store.hydrate()
    // A run that began on Monday and reached Share after midnight.
    store.markDone(MONDAY)
    expect(day(store, MONDAY).done).toBe(true)
    expect(day(store, TUESDAY).done).toBe(false)

    const next = await relaunch(storage)
    expect(day(next, MONDAY).done).toBe(true)
    expect(day(next, TUESDAY).done).toBe(false)
  })

  it("keeps the bell read after a relaunch that day, and not the next day", async () => {
    const storage = makeStorage()
    const store = createPauseProgressStore(storage)
    await store.hydrate()
    store.markBellRead(MONDAY)

    const next = await relaunch(storage)
    expect(day(next, MONDAY).bellRead).toBe(true)
    expect(day(next, TUESDAY).bellRead).toBe(false)
  })

  it("moves the record to a new day key and drops the old day", async () => {
    const storage = makeStorage()
    const store = createPauseProgressStore(storage)
    await store.hydrate()
    store.recordStep(MONDAY, "reflectScreen")
    store.markBellRead(TUESDAY)
    expect(day(store, TUESDAY)).toEqual({ ...EMPTY, bellRead: true })

    const next = await relaunch(storage)
    expect(day(next, TUESDAY)).toEqual({ ...EMPTY, bellRead: true })
    expect(day(next, MONDAY)).toEqual(EMPTY)
  })

  it("starts over: clears the saved step and keeps done and the bell", async () => {
    const storage = makeStorage()
    const store = createPauseProgressStore(storage)
    await store.hydrate()
    store.markBellRead(MONDAY)
    store.markDone(MONDAY)
    store.recordStep(MONDAY, "prayScreen")
    store.startOver(MONDAY)
    expect(day(store, MONDAY)).toEqual({
      step: null,
      done: true,
      bellRead: true,
    })

    const next = await relaunch(storage)
    expect(resumeTarget(day(next, MONDAY))).toBeNull()
  })

  it("keeps the stored step when an action lands before the first read", async () => {
    const seed = makeStorage()
    const first = createPauseProgressStore(seed)
    await first.hydrate()
    first.recordStep(MONDAY, "teaching")
    await settle()

    const store = createPauseProgressStore(seed)
    store.markBellRead(MONDAY)
    await settle()
    expect(day(store, MONDAY)).toEqual({
      step: "teaching",
      done: false,
      bellRead: true,
    })
  })

  it.each([
    ["text that is not JSON", "{not json"],
    ["a list", "[]"],
    [
      "an older version",
      JSON.stringify({
        version: 0,
        dayKey: MONDAY,
        step: "teaching",
        done: true,
        bellRead: true,
      }),
    ],
    [
      "a day key that does not read",
      JSON.stringify({ version: 1, dayKey: 20261005, step: "teaching" }),
    ],
  ])("reads %s as an empty day, with no throw", async (_, raw) => {
    const store = createPauseProgressStore(makeStorage(raw))
    await expect(store.hydrate()).resolves.toBeUndefined()
    expect(store.getSnapshot().status).toBe("ready")
    expect(day(store, MONDAY)).toEqual(EMPTY)
  })

  it("keeps the day when one field does not read", async () => {
    const raw = JSON.stringify({
      version: 1,
      dayKey: MONDAY,
      step: "intermission",
      done: true,
      bellRead: "yes",
    })
    const store = createPauseProgressStore(makeStorage(raw))
    await store.hydrate()
    expect(day(store, MONDAY)).toEqual({
      step: null,
      done: true,
      bellRead: false,
    })
  })
})

describe("usePauseDay under StrictMode", () => {
  const seen: PauseDayView[] = []
  let renderer: TestInstance | null = null

  afterEach(async () => {
    if (renderer) await unmount(renderer)
    renderer = null
    seen.length = 0
  })

  it("reads the stored day, then shows a new write at once", async () => {
    const storage = makeStorage()
    const seedStore = createPauseProgressStore(storage)
    await seedStore.hydrate()
    seedStore.recordStep(MONDAY, "film")
    await settle()

    const store = createPauseProgressStore(storage)
    function Probe() {
      seen.push(usePauseDay(MONDAY, store))
      return null
    }
    await act(async () => {
      renderer = TestRenderer.create(
        createElement(StrictMode, null, createElement(Probe)),
      )
    })
    expect(seen[0]).toEqual({ status: "loading", ...EMPTY })
    expect(seen.at(-1)).toEqual({ status: "ready", ...EMPTY, step: "film" })

    act(() => store.markDone(MONDAY))
    expect(seen.at(-1)).toEqual({
      status: "ready",
      step: "film",
      done: true,
      bellRead: false,
    })
    expect(storage.getItem).toHaveBeenCalledTimes(2)
  })
})
