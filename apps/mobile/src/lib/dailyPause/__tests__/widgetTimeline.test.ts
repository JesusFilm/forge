// The widget timeline (U14, KTD14, R9, R38). The writer runs over a fake widget
// that keeps every timeline, and over the REAL day-record store, so a Share
// reaches it the real way.

// The day-change case mounts the app's own stores, which load AsyncStorage.
jest.mock("@react-native-async-storage/async-storage", () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require("@react-native-async-storage/async-storage/jest/async-storage-mock"),
)

import { StrictMode, act, createElement } from "react"
import { AppState, type AppStateStatus } from "react-native"
import type { WidgetTimelineEntry } from "expo-widgets"

import {
  TestRenderer,
  unmount,
  type TestInstance,
} from "../../../test-utils/rnTestRenderer"
import { DEVOTIONALS } from "../devotionals"
import {
  PAUSE_DAY_STORAGE_KEY,
  createPauseProgressStore,
  resetPauseProgressStoreForTests,
  serializePauseDay,
  type PauseDayRecord,
} from "../progress"
import { resetPauseSettingsStoreForTests } from "../settings"
import {
  DailyPauseWidgetTimeline,
  buildDailyPauseWidgetTimeline,
  createDailyPauseWidgetWriter,
  type DailyPauseWidgetProps,
} from "../widgetTimeline"

type Timeline = WidgetTimelineEntry<DailyPauseWidgetProps>[]

const DAY_MS = 24 * 60 * 60 * 1000

/** The URL that the native intent turns into a curtain request. */
const WIDGET_URL = "forgemobile://daily-pause"

/** 9:00 AM on Monday 5 October 2026, a Pharisee day (AE3). */
const MONDAY_9AM = new Date(2026, 9, 5, 9, 0).getTime()

const NO_DAY: PauseDayRecord = {
  dayKey: null,
  step: null,
  done: false,
  bellRead: false,
}

/** Day keys from the test's own UTC arithmetic, not from the code under test. */
function dayKeys(from: string, count: number): string[] {
  const start = Date.parse(`${from}T00:00:00Z`)
  return Array.from({ length: count }, (_, index) =>
    new Date(start + index * DAY_MS).toISOString().slice(0, 10),
  )
}

/** The local calendar day of a date, written here rather than imported. */
function localKey(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${date.getFullYear()}-${month}-${day}`
}

function isLocalMidnight(date: Date): boolean {
  return (
    date.getHours() === 0 &&
    date.getMinutes() === 0 &&
    date.getSeconds() === 0 &&
    date.getMilliseconds() === 0
  )
}

/** The first local day whose UTC offset differs from the day before, if any. */
function firstDaylightSavingChange(): Date | null {
  for (let day = 1; day <= 730; day += 1) {
    const before = new Date(2026, 0, day - 1, 12).getTimezoneOffset()
    const noon = new Date(2026, 0, day, 12)
    if (noon.getTimezoneOffset() !== before) return noon
  }
  return null
}

/** R4: Pharisee on the anchor Monday, then the two alternate. */
function questionOn(index: number): string {
  return index % 2 === 0
    ? DEVOTIONALS.pharisee.question
    : DEVOTIONALS.lamp.question
}

function questionProps(question: string, done: boolean) {
  return {
    label: "DAILY BIBLE PAUSE",
    question,
    done,
    url: WIDGET_URL,
  }
}

function memoryStorage(seed: Record<string, string> = {}) {
  const items = new Map<string, string>(Object.entries(seed))
  return {
    getItem: async (key: string) => items.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      items.set(key, value)
    },
  }
}

/** Every fake call resolves at once, so all passes settle first. */
function idle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

function harness({
  now = MONDAY_9AM,
  progressSeed = {},
}: { now?: number; progressSeed?: Record<string, string> } = {}) {
  const timelines: Timeline[] = []
  const widget = {
    updateTimeline: (entries: Timeline) => {
      timelines.push(entries)
    },
  }
  const progress = createPauseProgressStore(memoryStorage(progressSeed))
  const appState = new Set<(state: string) => void>()
  let clock = now
  const writer = createDailyPauseWidgetWriter({
    widget,
    progress,
    subscribeToAppState: (listener) => {
      appState.add(listener)
      return () => {
        appState.delete(listener)
      }
    },
    now: () => clock,
  })
  return {
    timelines,
    latest: () => timelines.at(-1)!,
    progress,
    writer,
    setNow: (next: number) => {
      clock = next
    },
    emitAppState: (state: string) => {
      for (const listener of [...appState]) listener(state)
    },
  }
}

describe("buildDailyPauseWidgetTimeline", () => {
  it("holds 14 entries at local midnights, each naming that day's question (AE3)", () => {
    const entries = buildDailyPauseWidgetTimeline(MONDAY_9AM, NO_DAY)

    expect(entries.map((entry) => localKey(entry.date))).toEqual(
      dayKeys("2026-10-05", 14),
    )
    expect(entries.every((entry) => isLocalMidnight(entry.date))).toBe(true)
    expect(entries.map((entry) => entry.props)).toEqual(
      dayKeys("2026-10-05", 14).map((_, index) =>
        questionProps(questionOn(index), false),
      ),
    )
  })

  const change = firstDaylightSavingChange()
  const itAcrossChange = change ? it : it.skip
  itAcrossChange(
    change
      ? "keeps one entry per local midnight across a daylight-saving change"
      : "keeps one entry per local midnight across a daylight-saving change (SKIPPED: this runtime zone has none)",
    () => {
      const noon = change as Date
      const from = new Date(
        noon.getFullYear(),
        noon.getMonth(),
        noon.getDate() - 3,
        9,
      )
      const entries = buildDailyPauseWidgetTimeline(from.getTime(), NO_DAY)
      expect(entries.map((entry) => localKey(entry.date))).toEqual(
        dayKeys(localKey(from), 14),
      )
      expect(entries.every((entry) => isLocalMidnight(entry.date))).toBe(true)
    },
  )

  it("shows no check on Tuesday for Monday's done devotional (AE3)", () => {
    const tuesday = new Date(2026, 9, 6, 7, 0).getTime()
    const entries = buildDailyPauseWidgetTimeline(tuesday, {
      dayKey: "2026-10-05",
      step: "share",
      done: true,
      bellRead: true,
    })

    expect(entries[0]!.props).toEqual(
      questionProps(DEVOTIONALS.lamp.question, false),
    )
    expect(
      entries.filter((entry) => "done" in entry.props && entry.props.done),
    ).toHaveLength(0)
  })
})

describe("the widget timeline writer", () => {
  it("puts the check on today's entry after Share (R9)", async () => {
    const h = harness()
    h.writer.attach()
    await idle()
    expect(h.latest()[0]!.props).toEqual(
      questionProps(DEVOTIONALS.pharisee.question, false),
    )

    h.progress.markDone("2026-10-05")
    await idle()

    expect(h.latest()[0]!.props).toEqual(
      questionProps(DEVOTIONALS.pharisee.question, true),
    )
    expect(
      h.latest().map((entry) => "done" in entry.props && entry.props.done),
    ).toEqual([true, ...Array.from({ length: 13 }, () => false)])
  })

  it("waits for the saved day record, so today's check never drops", async () => {
    const h = harness({
      progressSeed: {
        [PAUSE_DAY_STORAGE_KEY]: serializePauseDay({
          dayKey: "2026-10-05",
          step: "share",
          done: true,
          bellRead: true,
        })!,
      },
    })

    h.writer.attach()
    await idle()

    expect(h.timelines.length).toBeGreaterThan(0)
    expect(
      h.timelines.every(
        (timeline) => timeline.length === 14 && timeline[0]!.props.done,
      ),
    ).toBe(true)
  })

  it("rewrites from the new day when the app returns to the foreground, and only then", async () => {
    const h = harness()
    h.writer.attach()
    await idle()
    h.setNow(new Date(2026, 9, 6, 8, 0).getTime())

    const writes = h.timelines.length
    h.emitAppState("inactive")
    h.emitAppState("background")
    await idle()
    expect(h.timelines).toHaveLength(writes)

    h.emitAppState("active")
    await idle()
    expect(localKey(h.latest()[0]!.date)).toBe("2026-10-06")
    expect(h.latest()[0]!.props).toEqual(
      questionProps(DEVOTIONALS.lamp.question, false),
    )
  })
})

// Simplification review: each day-record change (eight per run, plus the bell)
// rewrote the same 14 entries and reloaded the widget.
describe("a pass with nothing new", () => {
  it("writes nothing when the timeline is the one the widget has", async () => {
    const h = harness()
    h.writer.attach()
    await idle()
    const writes = h.timelines.length

    h.progress.markBellRead("2026-10-05")
    await idle()
    h.emitAppState("active")
    await idle()
    expect(h.timelines).toHaveLength(writes)

    h.progress.markDone("2026-10-05")
    await idle()
    expect(h.timelines).toHaveLength(writes + 1)
    expect(h.latest()[0]!.props.done).toBe(true)
  })
})

describe("DailyPauseWidgetTimeline", () => {
  let handlers: ((state: AppStateStatus) => void)[] = []
  const mounted = new Set<TestInstance>()

  /** Lets the stores' reads settle under fake timers. */
  async function settle() {
    await act(async () => {
      for (let tick = 0; tick < 10; tick += 1) await Promise.resolve()
    })
  }

  beforeEach(() => {
    resetPauseSettingsStoreForTests()
    resetPauseProgressStoreForTests()
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
    for (const renderer of mounted) await unmount(renderer)
    mounted.clear()
    jest.restoreAllMocks()
    jest.useRealTimers()
  })

  it("writes the timeline again after local midnight, from the new day", async () => {
    jest.useFakeTimers({ now: new Date(2026, 9, 5, 23, 59, 30) })
    const timelines: Timeline[] = []
    const widget = {
      updateTimeline: (entries: Timeline) => {
        timelines.push(entries)
      },
    }

    let renderer!: TestInstance
    await act(async () => {
      renderer = TestRenderer.create(
        createElement(
          StrictMode,
          null,
          createElement(DailyPauseWidgetTimeline, { widget }),
        ),
      )
    })
    mounted.add(renderer)
    await settle()
    expect(localKey(timelines.at(-1)![0]!.date)).toBe("2026-10-05")
    const writes = timelines.length

    await act(async () => {
      jest.advanceTimersByTime(30_000)
    })
    await settle()

    expect(timelines.length).toBeGreaterThan(writes)
    expect(localKey(timelines.at(-1)![0]!.date)).toBe("2026-10-06")
    expect(timelines.at(-1)![0]!.props).toEqual(
      questionProps(DEVOTIONALS.lamp.question, false),
    )
  })

  // The owner (2026-10-06): a widget added from the Home Screen shows today's
  // question on a first launch; no Customize setting turns it off.
  it("shows today's question on a first launch", async () => {
    jest.useFakeTimers({ now: MONDAY_9AM })
    const timelines: Timeline[] = []
    const widget = {
      updateTimeline: (entries: Timeline) => {
        timelines.push(entries)
      },
    }
    const todayQuestion = questionProps(DEVOTIONALS.pharisee.question, false)

    let renderer!: TestInstance
    await act(async () => {
      renderer = TestRenderer.create(
        createElement(
          StrictMode,
          null,
          createElement(DailyPauseWidgetTimeline, { widget }),
        ),
      )
    })
    mounted.add(renderer)
    await settle()
    expect(timelines.length).toBeGreaterThan(0)
    expect(timelines.at(-1)).toHaveLength(14)
    expect(timelines.at(-1)![0]!.props).toEqual(todayQuestion)
  })
})
