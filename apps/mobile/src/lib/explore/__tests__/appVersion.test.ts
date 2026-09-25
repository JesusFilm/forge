// The mock stands in for expo-constants; each test sets what it reports.
const mockConstants: { expoConfig?: unknown } = {}
jest.mock("expo-constants", () => ({
  __esModule: true,
  default: mockConstants,
}))

import { readAppVersion } from "../appVersion"

afterEach(() => {
  delete mockConstants.expoConfig
})

describe("readAppVersion", () => {
  it("reads the version from the app config", () => {
    mockConstants.expoConfig = { version: "1.4.0" }
    expect(readAppVersion()).toBe("1.4.0")
  })

  it.each([
    ["no config", undefined],
    ["a null config", null],
    ["a blank version", { version: "" }],
    ["a numeric version", { version: 14 }],
  ])("reads %s as unknown", (_case, config) => {
    mockConstants.expoConfig = config
    expect(readAppVersion()).toBe("unknown")
  })

  it("reads unknown, and never throws, when the config read throws", () => {
    Object.defineProperty(mockConstants, "expoConfig", {
      configurable: true,
      get: () => {
        throw new Error("no native module")
      },
    })
    expect(readAppVersion()).toBe("unknown")
  })
})
