// jest-expo sets __DEV__ to true, so every other suite sees an open gate. These
// cases set the REAL global, the env, the platform, and the constant, then
// re-require the binder, so a binder that drops or hardcodes an input fails.
/* eslint-disable @typescript-eslint/no-require-imports */
const mockEnv: {
  EXPO_PUBLIC_EXPLORE_ENABLED: string | undefined
  EXPO_PUBLIC_EXPLORE_ANDROID_ENABLED: string | undefined
} = {
  EXPO_PUBLIC_EXPLORE_ENABLED: undefined,
  EXPO_PUBLIC_EXPLORE_ANDROID_ENABLED: undefined,
}
const mockConstants = { EXPLORE_ENABLED: true }

jest.mock("../../../env", () => ({ env: mockEnv }))
jest.mock("../constants", () => mockConstants)

const devFlag = globalThis as unknown as { __DEV__: boolean }

type BundleSetup = {
  isDev?: boolean
  platform?: "ios" | "android"
  flag?: string
  androidFlag?: string
  overTheAir?: boolean
}

function loadBinder({
  isDev = false,
  platform = "ios",
  flag,
  androidFlag,
  overTheAir = true,
}: BundleSetup): () => boolean {
  devFlag.__DEV__ = isDev
  mockEnv.EXPO_PUBLIC_EXPLORE_ENABLED = flag
  mockEnv.EXPO_PUBLIC_EXPLORE_ANDROID_ENABLED = androidFlag
  mockConstants.EXPLORE_ENABLED = overTheAir
  jest.resetModules()
  // A whole-module mock of react-native breaks jest-expo's own setup, so the
  // fresh instance the binder is about to load gets the platform instead.
  const { Platform } = require("react-native")
  Object.defineProperty(Platform, "OS", { value: platform, configurable: true })
  return require("../availability").isExploreAvailable
}

describe("isExploreAvailable", () => {
  let previousDev: boolean

  beforeEach(() => {
    previousDev = devFlag.__DEV__
  })

  afterEach(() => {
    devFlag.__DEV__ = previousDev
  })

  it("hides the tab in a release bundle when the variable is not set", () => {
    expect(loadBinder({})()).toBe(false)
  })

  // The anti-vacuous companion: a binder that always returns false passes the
  // case above.
  it("shows the tab in a release iOS bundle when the variable is 1", () => {
    expect(loadBinder({ flag: "1" })()).toBe(true)
  })

  it("reads __DEV__, so a development bundle shows the tab", () => {
    expect(loadBinder({ isDev: true })()).toBe(true)
  })

  it("reads the platform and the Android variable", () => {
    expect(loadBinder({ platform: "android", flag: "1" })()).toBe(false)
    expect(
      loadBinder({ platform: "android", flag: "1", androidFlag: "1" })(),
    ).toBe(true)
  })

  it("reads the over-the-air constant", () => {
    expect(loadBinder({ isDev: true, overTheAir: false })()).toBe(false)
  })

  // KTD16: a runtime flip would remount the whole NativeTabs navigator, so the
  // answer is fixed when the module loads.
  it("resolves once, when the module loads", () => {
    const isExploreAvailable = loadBinder({ flag: "1" })
    mockEnv.EXPO_PUBLIC_EXPLORE_ENABLED = undefined
    devFlag.__DEV__ = false
    expect(isExploreAvailable()).toBe(true)
  })
})
