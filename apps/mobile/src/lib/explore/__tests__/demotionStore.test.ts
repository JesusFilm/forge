/**
 * KTD3's stored demotion. Every case builds its own store over its own fake
 * storage, so no module singleton crosses a case.
 */

/* eslint-disable @typescript-eslint/no-require-imports */

// The module's singleton binds AsyncStorage at import; the cases never reach it.
jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock"),
)

import {
  DEMOTION_READ_TIMEOUT_MS,
  DEMOTION_STORAGE_KEY,
  DEMOTION_VERSION,
  createDemotionStore,
  parseStoredDemotion,
  serializeDemotion,
} from "../demotionStore"
import { DEMOTION_MAX_AGE_MS, resolvePlayerMode } from "../playerMode"

const T0 = Date.UTC(2026, 8, 25, 10, 0, 0)

function makeStorage(seed: string | null = null) {
  const items = new Map<string, string>()
  if (seed != null) items.set(DEMOTION_STORAGE_KEY, seed)
  return {
    items,
    getItem: jest.fn(async (key: string) => items.get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => {
      items.set(key, value)
    }),
  }
}

/** The launch-time rule, as the feed runs it on an iOS device. */
function launchMode(
  storedDemotion: ReturnType<typeof parseStoredDemotion>,
  appVersion: string,
  nowMs: number,
) {
  return resolvePlayerMode({
    platform: "ios",
    totalMemoryBytes: null,
    standbyErrorsThisLaunch: 0,
    storedDemotion,
    appVersion,
    nowMs,
  })
}

afterEach(() => {
  jest.useRealTimers()
})

describe("parseStoredDemotion", () => {
  it("reads back what serializeDemotion writes", () => {
    const value = { demotedAtMs: T0, appVersion: "1.4.0" }
    expect(parseStoredDemotion(serializeDemotion(value))).toEqual(value)
  })

  it.each([
    ["no value", null],
    ["bad JSON", "{"],
    ["an array", "[]"],
    [
      "another version",
      JSON.stringify({ v: DEMOTION_VERSION + 1, at: T0, app: "1.4.0" }),
    ],
    ["a missing time", JSON.stringify({ v: DEMOTION_VERSION, app: "1.4.0" })],
    [
      "a fractional time",
      JSON.stringify({ v: DEMOTION_VERSION, at: 1.5, app: "1.4.0" }),
    ],
    [
      "a negative time",
      JSON.stringify({ v: DEMOTION_VERSION, at: -1, app: "1.4.0" }),
    ],
    [
      "a blank version",
      JSON.stringify({ v: DEMOTION_VERSION, at: T0, app: " " }),
    ],
    [
      "a numeric version",
      JSON.stringify({ v: DEMOTION_VERSION, at: T0, app: 14 }),
    ],
  ])("reads %s as no demotion", (_case, raw) => {
    expect(parseStoredDemotion(raw)).toBeNull()
  })
})

describe("the demotion store", () => {
  it("writes the demotion so that the next launch reads it as one player", async () => {
    const storage = makeStorage()
    const launch = createDemotionStore(storage)
    await expect(
      launch.write({ demotedAtMs: T0, appVersion: "1.4.0" }),
    ).resolves.toBe(true)

    // A fresh store is what the next launch builds over the same storage.
    const nextLaunch = createDemotionStore(storage)
    const stored = await nextLaunch.read()
    expect(stored).toEqual({ demotedAtMs: T0, appVersion: "1.4.0" })
    expect(launchMode(stored, "1.4.0", T0 + 60_000)).toBe("one")
    // An app update or the 7-day age clears it, as KTD3 says.
    expect(launchMode(stored, "1.5.0", T0 + 60_000)).toBe("two")
    expect(launchMode(stored, "1.4.0", T0 + DEMOTION_MAX_AGE_MS)).toBe("two")
  })

  it("reads nothing when no launch has demoted", async () => {
    await expect(createDemotionStore(makeStorage()).read()).resolves.toBeNull()
  })

  it("never rejects a read, whether storage rejects or throws", async () => {
    const rejects = makeStorage()
    rejects.getItem.mockRejectedValueOnce(new Error("disk"))
    await expect(createDemotionStore(rejects).read()).resolves.toBeNull()

    const throws = makeStorage()
    throws.getItem.mockImplementationOnce(() => {
      throw new Error("sync")
    })
    await expect(createDemotionStore(throws).read()).resolves.toBeNull()
  })

  it("reads a slow value as none, so the first clip never waits on it", async () => {
    jest.useFakeTimers()
    const storage = makeStorage(
      serializeDemotion({ demotedAtMs: T0, appVersion: "1.4.0" }),
    )
    storage.getItem.mockImplementationOnce(() => new Promise(() => {}))
    const read = createDemotionStore(storage).read()
    let settled: unknown = "pending"
    void read.then((value) => {
      settled = value
    })

    await jest.advanceTimersByTimeAsync(DEMOTION_READ_TIMEOUT_MS - 1)
    expect(settled).toBe("pending")
    await jest.advanceTimersByTimeAsync(1)
    expect(settled).toBeNull()
  })

  it("never rejects a write, and reports one that did not land", async () => {
    const rejects = makeStorage()
    rejects.setItem.mockRejectedValueOnce(new Error("full"))
    await expect(
      createDemotionStore(rejects).write({ demotedAtMs: T0, appVersion: "1" }),
    ).resolves.toBe(false)

    const throws = makeStorage()
    throws.setItem.mockImplementationOnce(() => {
      throw new Error("sync")
    })
    await expect(
      createDemotionStore(throws).write({ demotedAtMs: T0, appVersion: "1" }),
    ).resolves.toBe(false)
  })
})
