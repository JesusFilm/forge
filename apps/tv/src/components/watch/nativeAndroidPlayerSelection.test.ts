import { shouldUseNativeAndroidPlayer } from "./nativeAndroidPlayerSelection"

describe("shouldUseNativeAndroidPlayer", () => {
  it("uses native playback on hydrated Android TV when selected", () => {
    expect(
      shouldUseNativeAndroidPlayer({
        variant: "native",
        hydrated: true,
        platform: "android",
      }),
    ).toBe(true)
  })

  it("honors an explicit React Native player selection", () => {
    expect(
      shouldUseNativeAndroidPlayer({
        variant: "existing",
        hydrated: true,
        platform: "android",
      }),
    ).toBe(false)
  })

  it("never selects the Android player on Apple TV or before hydration", () => {
    expect(
      shouldUseNativeAndroidPlayer({
        variant: "native",
        hydrated: true,
        platform: "ios",
      }),
    ).toBe(false)
    expect(
      shouldUseNativeAndroidPlayer({
        variant: "native",
        hydrated: false,
        platform: "android",
      }),
    ).toBe(false)
  })
})
