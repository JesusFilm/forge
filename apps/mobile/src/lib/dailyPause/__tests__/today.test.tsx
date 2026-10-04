// The day clock (U4, KTD11, R4). The hook cases wrap the element in StrictMode
// (RTL is not installed here) and drive AppState through a spy.
import { StrictMode, act, createElement } from "react"
import { AppState, type AppStateStatus } from "react-native"

import {
  TestRenderer,
  unmount,
  type TestInstance,
} from "../../../test-utils/rnTestRenderer"
import { DEVOTIONALS } from "../devotionals"
import { devotionalForDay, localDay, useToday } from "../today"

const DAY_MS = 24 * 60 * 60 * 1000

/** Day keys from the test's own UTC arithmetic, not from the code under test. */
function dayKeys(from: string, count: number): string[] {
  const start = Date.parse(`${from}T00:00:00Z`)
  return Array.from({ length: count }, (_, index) =>
    new Date(start + index * DAY_MS).toISOString().slice(0, 10),
  )
}

/** The local days of 2026 whose UTC offset differs from the day before. */
function daylightSavingChanges(): Date[] {
  const changes: Date[] = []
  for (let day = 1; day <= 365; day += 1) {
    const before = new Date(2026, 0, day - 1, 12).getTimezoneOffset()
    const noon = new Date(2026, 0, day, 12)
    if (noon.getTimezoneOffset() !== before) changes.push(noon)
  }
  return changes
}

describe("localDay", () => {
  it("names the phone's own calendar day, padded", () => {
    expect(localDay(new Date(2026, 0, 5, 9, 0))).toBe("2026-01-05")
    // Late evening stays on the same local day, whatever UTC says.
    expect(localDay(new Date(2026, 9, 1, 23, 30))).toBe("2026-10-01")
  })
})

describe("the devotional of a day (R4)", () => {
  it("gives Monday and Tuesday different devotionals (AE3)", () => {
    const monday = devotionalForDay("2026-10-05")
    const tuesday = devotionalForDay("2026-10-06")
    expect([monday.id, tuesday.id].sort()).toEqual(["lamp", "pharisee"])
  })

  it("gives one day key the same devotional every time", () => {
    for (const key of dayKeys("2026-10-01", 10)) {
      expect(devotionalForDay(key)).toBe(devotionalForDay(key))
    }
  })

  it.each([
    ["a month end", "2026-10-28"],
    ["a year end", "2026-12-29"],
    ["a 28-day February", "2027-02-26"],
    ["a leap day", "2028-02-27"],
  ])("alternates across %s", (_, from) => {
    const ids = dayKeys(from, 6).map((key) => devotionalForDay(key).id)
    const repeats = ids.filter((id, index) => id === ids[index - 1])
    expect(repeats).toEqual([])
    expect(new Set(ids)).toEqual(new Set(["pharisee", "lamp"]))
  })

  it("returns the devotional's own content", () => {
    const keys = dayKeys("2026-10-05", 2)
    for (const key of keys) {
      const devotional = devotionalForDay(key)
      expect(devotional).toBe(DEVOTIONALS[devotional.id])
    }
  })
})

// A runtime ignores a mid-process TZ change under jest, so this case uses the
// zone the suite runs in. A zone with no change (UTC on CI) has nothing to prove.
const changes = daylightSavingChanges()
const describeChanges = changes.length > 0 ? describe : describe.skip

describeChanges(
  changes.length > 0
    ? "across this zone's daylight-saving changes"
    : "across a daylight-saving change (SKIPPED: this runtime zone has none)",
  () => {
    it.each(changes.map((noon) => [localDay(noon), noon]))(
      "alternates by local day around %s",
      (_, noon) => {
        const day = noon as Date
        // Real instants every 30 minutes, from two days before to two after.
        const start = new Date(
          day.getFullYear(),
          day.getMonth(),
          day.getDate() - 2,
        ).getTime()
        const end = new Date(
          day.getFullYear(),
          day.getMonth(),
          day.getDate() + 3,
        ).getTime()
        const byDay = new Map<string, Set<string>>()
        for (let at = start; at < end; at += 30 * 60 * 1000) {
          const key = localDay(new Date(at))
          const ids = byDay.get(key) ?? new Set<string>()
          ids.add(devotionalForDay(key).id)
          byDay.set(key, ids)
        }
        expect([...byDay.keys()]).toHaveLength(5)
        const ids = [...byDay.values()].map((set) => [...set])
        expect(ids.every((one) => one.length === 1)).toBe(true)
        const flat = ids.map((one) => one[0])
        expect(flat.filter((id, index) => id === flat[index - 1])).toEqual([])
      },
    )
  },
)

describe("useToday (KTD11)", () => {
  type Seen = ReturnType<typeof useToday>
  const seen: Seen[] = []
  let handlers: ((state: AppStateStatus) => void)[] = []

  function Probe() {
    seen.push(useToday())
    return null
  }

  // The clock is module-wide, so a case that fails before its unmount must
  // not leave its subscription to the next case.
  const mounted = new Set<TestInstance>()

  async function mount(probes = 1): Promise<TestInstance> {
    let renderer!: TestInstance
    const children = Array.from({ length: probes }, (_, index) =>
      createElement(Probe, { key: index }),
    )
    await act(async () => {
      renderer = TestRenderer.create(
        createElement(StrictMode, null, ...children),
      )
    })
    mounted.add(renderer)
    return renderer
  }

  async function unmountProbe(renderer: TestInstance) {
    mounted.delete(renderer)
    await unmount(renderer)
  }

  function appState(state: AppStateStatus) {
    act(() => {
      for (const handler of [...handlers]) handler(state)
    })
  }

  beforeEach(() => {
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
    seen.length = 0
    jest.restoreAllMocks()
    jest.useRealTimers()
  })

  it("gives today's key and its devotional", async () => {
    jest.useFakeTimers({ now: new Date(2026, 9, 5, 9, 0) })
    const renderer = await mount()
    expect(seen.at(-1)!.dayKey).toBe("2026-10-05")
    expect(seen.at(-1)!.devotional).toBe(devotionalForDay("2026-10-05"))
    await unmountProbe(renderer)
  })

  it("moves to the new day when the app returns to active after midnight", async () => {
    jest.useFakeTimers({ now: new Date(2026, 9, 5, 23, 0) })
    const renderer = await mount()
    const before = seen.at(-1)!
    appState("background")
    // A clock change fires no timer, so only the return can move the day.
    jest.setSystemTime(new Date(2026, 9, 6, 8, 0))
    expect(seen.at(-1)!.dayKey).toBe("2026-10-05")
    appState("active")
    expect(seen.at(-1)!.dayKey).toBe("2026-10-06")
    expect(seen.at(-1)!.devotional.id).not.toBe(before.devotional.id)
    await unmountProbe(renderer)
  })

  it("moves to the new day at local midnight in the foreground", async () => {
    jest.useFakeTimers({ now: new Date(2026, 9, 5, 23, 59, 30) })
    const renderer = await mount()
    await act(async () => {
      jest.advanceTimersByTime(29_000)
    })
    expect(seen.at(-1)!.dayKey).toBe("2026-10-05")
    await act(async () => {
      jest.advanceTimersByTime(1_000)
    })
    expect(seen.at(-1)!.dayKey).toBe("2026-10-06")
    await act(async () => {
      jest.advanceTimersByTime(DAY_MS)
    })
    expect(seen.at(-1)!.dayKey).toBe("2026-10-07")
    await unmountProbe(renderer)
  })

  it("keeps one midnight timer and one AppState listener under StrictMode", async () => {
    jest.useFakeTimers({ now: new Date(2026, 9, 5, 9, 0) })
    // React schedules short timers of its own, so count only the long ones.
    const set = jest.spyOn(globalThis, "setTimeout")
    const clear = jest.spyOn(globalThis, "clearTimeout")
    const liveMidnightTimers = () => {
      const cleared = new Set(clear.mock.calls.map(([id]) => id))
      return set.mock.calls.filter(
        ([, delay], index) =>
          (delay ?? 0) >= 60 * 60 * 1000 &&
          !cleared.has(set.mock.results[index]?.value),
      ).length
    }
    const renderer = await mount(2)
    expect(handlers).toHaveLength(1)
    expect(liveMidnightTimers()).toBe(1)
    await unmountProbe(renderer)
    expect(handlers).toHaveLength(0)
    expect(liveMidnightTimers()).toBe(0)
  })
})
