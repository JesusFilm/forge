// The mocks stand in for the native module; each test sets what they report.
const mockApplication: {
  nativeApplicationVersion: string | null
  nativeBuildVersion: string | null
} = { nativeApplicationVersion: "1.0.0", nativeBuildVersion: "7" }
const mockApplicationFactory = jest.fn(() => mockApplication)
jest.mock("expo-application", () => mockApplicationFactory())
const mockNativeModule: { current: object | null; probed: string[] } = {
  current: {},
  probed: [],
}
jest.mock("expo", () => ({
  requireOptionalNativeModule: (name: string) => {
    mockNativeModule.probed.push(name)
    return mockNativeModule.current
  },
}))
const mockConstants: { expoConfig: { version?: unknown } | null } = {
  expoConfig: { version: "1.0.0" },
}
jest.mock("expo-constants", () => ({
  __esModule: true,
  default: mockConstants,
}))

import { formatAppVersion, readAppVersionParts } from "../appVersion"

beforeEach(() => {
  mockApplication.nativeApplicationVersion = "1.0.0"
  mockApplication.nativeBuildVersion = "7"
  mockNativeModule.current = {}
  mockNativeModule.probed = []
  mockConstants.expoConfig = { version: "1.0.0" }
})

describe("formatAppVersion", () => {
  it("shows the version and the build number", () => {
    expect(formatAppVersion({ version: "1.0.0", build: "7" })).toBe(
      "Version 1.0.0 (7)",
    )
  })

  it("shows the version alone when the build number is null", () => {
    expect(formatAppVersion({ version: "1.0.0", build: null })).toBe(
      "Version 1.0.0",
    )
  })

  it("treats a blank build number as absent", () => {
    expect(formatAppVersion({ version: "1.0.0", build: "  " })).toBe(
      "Version 1.0.0",
    )
  })

  it.each([
    ["null", null],
    ["blank", " "],
  ])("gives no line for a %s version, even with a build", (_name, version) => {
    expect(formatAppVersion({ version, build: "7" })).toBeNull()
  })
})

describe("readAppVersionParts", () => {
  it("reads the native version and build from expo-application", () => {
    mockApplication.nativeApplicationVersion = "2.3.4"
    mockApplication.nativeBuildVersion = "41"
    mockConstants.expoConfig = { version: "9.9.9" }
    expect(readAppVersionParts()).toEqual({ version: "2.3.4", build: "41" })
    expect(mockNativeModule.probed).toEqual(["ExpoApplication"])
  })

  it("falls back to the app config version when the native one is null", () => {
    mockApplication.nativeApplicationVersion = null
    mockApplication.nativeBuildVersion = null
    mockConstants.expoConfig = { version: "1.0.0" }
    expect(readAppVersionParts()).toEqual({ version: "1.0.0", build: null })
  })

  it("gives nulls when neither source has a version", () => {
    mockApplication.nativeApplicationVersion = null
    mockApplication.nativeBuildVersion = null
    mockConstants.expoConfig = null
    expect(readAppVersionParts()).toEqual({ version: null, build: null })
    expect(formatAppVersion(readAppVersionParts())).toBeNull()
  })

  it("never requires expo-application when the binary lacks its native module", () => {
    // A dev client built before expo-application red-boxes on the require.
    jest.resetModules()
    mockNativeModule.current = null
    mockApplicationFactory.mockClear()
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fresh = require("../appVersion") as typeof import("../appVersion")
    expect(fresh.readAppVersionParts()).toEqual({
      version: "1.0.0",
      build: null,
    })
    expect(mockApplicationFactory).toHaveBeenCalledTimes(0)
  })

  it("falls back, and never throws, when expo-application throws on require", () => {
    jest.resetModules()
    jest.doMock("expo-application", () => {
      throw new Error("Cannot find native module 'ExpoApplication'")
    })
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const fresh = require("../appVersion") as typeof import("../appVersion")
      expect(() => fresh.readAppVersionParts()).not.toThrow()
      expect(fresh.readAppVersionParts()).toEqual({
        version: "1.0.0",
        build: null,
      })
    } finally {
      jest.resetModules()
      jest.doMock("expo-application", () => mockApplication)
    }
  })
})
