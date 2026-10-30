/**
 * The guard that keeps Android and dev clients built before the module off
 * the native control, where it would draw "Unimplemented component".
 */
type Guard = typeof import("../nativeSegmentedControl")

function loadGuard(
  os: "ios" | "android",
  hasViewManagerConfig: ((name: string) => boolean) | undefined,
): Guard {
  let guard: Guard | undefined
  jest.isolateModules(() => {
    jest.doMock("react-native", () => ({
      Platform: { OS: os },
      UIManager: { hasViewManagerConfig },
    }))
    guard = jest.requireActual<Guard>("../nativeSegmentedControl")
  })
  return guard!
}

afterEach(() => {
  jest.dontMock("react-native")
})

describe("canUseNativeSegmentedControl", () => {
  it("is true on iOS when the binary has RNCSegmentedControl", () => {
    const has = jest.fn((name: string) => name === "RNCSegmentedControl")
    expect(loadGuard("ios", has).canUseNativeSegmentedControl()).toBe(true)
    expect(has).toHaveBeenCalledWith("RNCSegmentedControl")
  })

  it("is false on iOS when the binary lacks the view", () => {
    expect(loadGuard("ios", () => false).canUseNativeSegmentedControl()).toBe(
      false,
    )
    expect(loadGuard("ios", undefined).canUseNativeSegmentedControl()).toBe(
      false,
    )
  })

  it("is false on Android, which draws the JS control", () => {
    const has = jest.fn(() => true)
    expect(loadGuard("android", has).canUseNativeSegmentedControl()).toBe(false)
  })

  it("asks the binary once per launch", () => {
    const has = jest.fn(() => true)
    const guard = loadGuard("ios", has)
    guard.canUseNativeSegmentedControl()
    guard.canUseNativeSegmentedControl()
    expect(has).toHaveBeenCalledTimes(1)
  })
})
