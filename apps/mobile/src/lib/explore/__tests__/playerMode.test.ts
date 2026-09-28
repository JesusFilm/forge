import {
  DEMOTION_ERROR_WINDOW_MS,
  DEMOTION_MAX_AGE_MS,
  DEMOTION_STANDBY_ERROR_COUNT,
  LOW_MEMORY_THRESHOLD_BYTES,
  launchDemoted,
  resolvePlayerMode,
  standbyErrorCountsTowardDemotion,
  type PlayerModeInput,
} from "../playerMode"

const GIB = 1024 ** 3
const DAY_MS = 24 * 60 * 60 * 1000
const NOW = Date.UTC(2026, 8, 25, 12)

function input(overrides: Partial<PlayerModeInput> = {}): PlayerModeInput {
  return {
    platform: "android",
    totalMemoryBytes: 6 * GIB,
    standbyErrorsThisLaunch: 0,
    storedDemotion: null,
    appVersion: "1.4.0",
    nowMs: NOW,
    ...overrides,
  }
}

const recentDemotion = { demotedAtMs: NOW - DAY_MS, appVersion: "1.4.0" }

describe("the tunable constants", () => {
  it("start at KTD3's values", () => {
    expect(LOW_MEMORY_THRESHOLD_BYTES).toBe(3.5 * GIB)
    expect(DEMOTION_ERROR_WINDOW_MS).toBe(8_000)
    expect(DEMOTION_STANDBY_ERROR_COUNT).toBe(2)
    expect(DEMOTION_MAX_AGE_MS).toBe(7 * DAY_MS)
  })
})

describe("resolvePlayerMode", () => {
  // KTD3's table, row by row, on Android.
  type Row = [string, Partial<PlayerModeInput>, "two" | "one"]
  const rows: Row[] = [
    ["at or above the threshold, no errors, no demotion", {}, "two"],
    [
      "exactly at the threshold",
      { totalMemoryBytes: LOW_MEMORY_THRESHOLD_BYTES },
      "two",
    ],
    [
      "at or above the threshold, two standby errors",
      { standbyErrorsThisLaunch: 2 },
      "one",
    ],
    [
      "at or above the threshold, one standby error",
      { standbyErrorsThisLaunch: 1 },
      "two",
    ],
    ["a stored demotion", { storedDemotion: recentDemotion }, "one"],
    [
      "below the threshold",
      { totalMemoryBytes: LOW_MEMORY_THRESHOLD_BYTES - 1 },
      "one",
    ],
    ["a 3 GB device", { totalMemoryBytes: 3 * GIB }, "one"],
    // Android reports usable RAM, so a phone sold as 4 GB reads about 3.7 GiB.
    ["a phone sold as 4 GB", { totalMemoryBytes: 3.7 * GIB }, "two"],
    ["a phone sold as 3 GB", { totalMemoryBytes: 2.8 * GIB }, "one"],
  ]

  it.each(rows)("android, %s", (_name, overrides, mode) => {
    expect(resolvePlayerMode(input(overrides))).toBe(mode)
  })

  it("uses only the error and stored-demotion rows on iOS", () => {
    const ios = { platform: "ios" as const, totalMemoryBytes: 2 * GIB }
    expect(resolvePlayerMode(input(ios))).toBe("two")
    expect(
      resolvePlayerMode(input({ ...ios, standbyErrorsThisLaunch: 2 })),
    ).toBe("one")
    expect(
      resolvePlayerMode(input({ ...ios, storedDemotion: recentDemotion })),
    ).toBe("one")
  })

  it.each([
    ["missing", null],
    ["not a number", Number.NaN],
    ["zero", 0],
  ])(
    "gives two players on both platforms when the memory value is %s",
    (_name, totalMemoryBytes) => {
      expect(resolvePlayerMode(input({ totalMemoryBytes }))).toBe("two")
      expect(
        resolvePlayerMode(input({ platform: "ios", totalMemoryBytes })),
      ).toBe("two")
    },
  )

  it("ignores a stored demotion older than 7 days", () => {
    const aged = (ageMs: number) =>
      resolvePlayerMode(
        input({
          storedDemotion: { demotedAtMs: NOW - ageMs, appVersion: "1.4.0" },
        }),
      )
    expect(aged(DEMOTION_MAX_AGE_MS - 1)).toBe("one")
    expect(aged(DEMOTION_MAX_AGE_MS + 1)).toBe("two")
  })

  it("ignores a stored demotion from another app version", () => {
    expect(
      resolvePlayerMode(
        input({
          storedDemotion: { demotedAtMs: NOW - DAY_MS, appVersion: "1.3.9" },
        }),
      ),
    ).toBe("two")
  })
})

describe("standby errors toward a demotion", () => {
  it("counts an error within 8 s of the source set while the active player is healthy", () => {
    expect(
      standbyErrorCountsTowardDemotion({
        msSinceSourceSet: 2_000,
        activeHealthy: true,
      }),
    ).toBe(true)
    expect(
      standbyErrorCountsTowardDemotion({
        msSinceSourceSet: DEMOTION_ERROR_WINDOW_MS,
        activeHealthy: true,
      }),
    ).toBe(true)
  })

  it("never counts a slow load: an error after the window does not count", () => {
    expect(
      standbyErrorCountsTowardDemotion({
        msSinceSourceSet: DEMOTION_ERROR_WINDOW_MS + 1,
        activeHealthy: true,
      }),
    ).toBe(false)
  })

  it("does not count while the active player is not healthy", () => {
    expect(
      standbyErrorCountsTowardDemotion({
        msSinceSourceSet: 1_000,
        activeHealthy: false,
      }),
    ).toBe(false)
  })

  it("demotes the launch at the second counted error", () => {
    expect(launchDemoted(1)).toBe(false)
    expect(launchDemoted(2)).toBe(true)
    expect(launchDemoted(3)).toBe(true)
  })
})
