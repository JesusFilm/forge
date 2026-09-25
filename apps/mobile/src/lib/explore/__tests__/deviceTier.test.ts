// The mock stands in for the native module; each test sets what it reports.
const mockDevice: { totalMemory: unknown } = { totalMemory: null }
jest.mock("expo-device", () => mockDevice)

import { readDeviceTier } from "../deviceTier"
import { resolvePlayerMode, type PlayerModeInput } from "../playerMode"

const GIB = 1024 ** 3

function modeFor(
  platform: PlayerModeInput["platform"],
  totalMemoryBytes: number | null,
) {
  return resolvePlayerMode({
    platform,
    totalMemoryBytes,
    standbyErrorsThisLaunch: 0,
    storedDemotion: null,
    appVersion: "1.0.0",
    nowMs: 0,
  })
}

beforeEach(() => {
  mockDevice.totalMemory = null
})

describe("readDeviceTier", () => {
  it("passes a reported memory value through in bytes", () => {
    mockDevice.totalMemory = 2.8 * GIB
    expect(readDeviceTier()).toEqual({ totalMemoryBytes: 2.8 * GIB })
  })

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["zero", 0],
    ["negative", -1],
    ["NaN", Number.NaN],
    ["a string", "4294967296"],
  ])("gives an unknown tier for a %s value", (_name, value) => {
    mockDevice.totalMemory = value
    expect(readDeviceTier()).toEqual({ totalMemoryBytes: null })
  })

  it("gives an unknown tier, and never throws, when the module is missing", () => {
    // The registry already holds the first mock; a throwing factory needs a
    // fresh one, and the next test needs the first mock back.
    jest.resetModules()
    jest.doMock("expo-device", () => {
      throw new Error("Cannot find native module 'ExpoDevice'")
    })
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const fresh = require("../deviceTier") as typeof import("../deviceTier")
      expect(() => fresh.readDeviceTier()).not.toThrow()
      expect(fresh.readDeviceTier()).toEqual({ totalMemoryBytes: null })
    } finally {
      jest.resetModules()
      jest.doMock("expo-device", () => mockDevice)
    }
  })

  it("gives an unknown tier when reading the value throws", () => {
    Object.defineProperty(mockDevice, "totalMemory", {
      configurable: true,
      get() {
        throw new Error("native read failed")
      },
    })
    try {
      expect(readDeviceTier()).toEqual({ totalMemoryBytes: null })
    } finally {
      Object.defineProperty(mockDevice, "totalMemory", {
        configurable: true,
        writable: true,
        value: null,
      })
    }
  })

  it("gives two players on iOS and on Android for an unknown tier", () => {
    const { totalMemoryBytes } = readDeviceTier()
    expect(totalMemoryBytes).toBeNull()
    expect(modeFor("ios", totalMemoryBytes)).toBe("two")
    expect(modeFor("android", totalMemoryBytes)).toBe("two")
  })

  it("gives one player for a low-memory Android reading", () => {
    mockDevice.totalMemory = 2.8 * GIB
    expect(modeFor("android", readDeviceTier().totalMemoryBytes)).toBe("one")
  })
})
