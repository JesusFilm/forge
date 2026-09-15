import { shouldUseNativeSwiftPlayer } from "./nativePlayerSelection"

describe("shouldUseNativeSwiftPlayer", () => {
  it("is opt-in on hydrated Apple TV", () => {
    expect(
      shouldUseNativeSwiftPlayer({
        variant: "native-a",
        hydrated: true,
        platform: "ios",
      }),
    ).toBe(true)
    expect(
      shouldUseNativeSwiftPlayer({
        variant: "native-b",
        hydrated: true,
        platform: "ios",
      }),
    ).toBe(true)
  })

  it("keeps the existing player as the default and Android fallback", () => {
    expect(
      shouldUseNativeSwiftPlayer({
        variant: "existing",
        hydrated: true,
        platform: "ios",
      }),
    ).toBe(false)
    expect(
      shouldUseNativeSwiftPlayer({
        variant: "native-b",
        hydrated: true,
        platform: "android",
      }),
    ).toBe(false)
  })

  it("does not switch players before preferences hydrate", () => {
    expect(
      shouldUseNativeSwiftPlayer({
        variant: "native-a",
        hydrated: false,
        platform: "ios",
      }),
    ).toBe(false)
  })
})
