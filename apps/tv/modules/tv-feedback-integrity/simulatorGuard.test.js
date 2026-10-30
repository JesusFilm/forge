/* global require, jest, describe, it, expect, beforeEach */
/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require("fs")
const path = require("path")
const mockPlatform = { OS: "ios" }
const mockNative = jest.fn()
jest.mock("react-native", () => ({ Platform: mockPlatform }))
jest.mock("expo", () => ({
  requireOptionalNativeModule: (...args) => mockNative(...args),
}))

beforeEach(() => {
  jest.resetModules()
  mockNative.mockReset()
})

describe("native simulator capability bridge", () => {
  it.each(["ios", "android"])(
    "requires an explicit native boolean for %s",
    (os) => {
      mockPlatform.OS = os
      for (const module of [
        null,
        {},
        { isFeedbackSimulator: false },
        { isFeedbackSimulator: "true" },
        { isFeedbackSimulator: true },
      ]) {
        mockNative.mockReturnValue(module)
        jest.isolateModules(() => {
          const { isFeedbackSimulatorNative } = require("./index")
          expect(isFeedbackSimulatorNative()).toBe(
            module?.isFeedbackSimulator === true,
          )
        })
      }
    },
  )

  it("does not treat an unsupported platform as a simulator", () => {
    mockPlatform.OS = "web"
    mockNative.mockReturnValue({ isFeedbackSimulator: true })
    jest.isolateModules(() => {
      expect(require("./index").isFeedbackSimulatorNative()).toBe(false)
    })
    expect(mockNative).not.toHaveBeenCalled()
  })
})

describe("native release exclusion source contracts", () => {
  it("Apple enables the constant only for a Debug tvOS simulator", () => {
    const swift = fs.readFileSync(
      path.join(__dirname, "ios/TvFeedbackAppleIntegrityModule.swift"),
      "utf8",
    )
    expect(swift).toMatch(
      /#if DEBUG && targetEnvironment\(simulator\) && os\(tvOS\)\s+return \["isFeedbackSimulator": true\]\s+#else\s+return \["isFeedbackSimulator": false\]\s+#endif/,
    )
    expect(swift).toContain("guard DCDevice.current.isSupported else")
    expect(swift).toContain("DCDevice.current.generateToken")
  })

  it("Android requires the generated native DEBUG guard and a debuggable SDK TV emulator", () => {
    const kotlin = fs.readFileSync(
      path.join(
        __dirname,
        "android/src/main/java/expo/modules/tvfeedbackintegrity/TvFeedbackIntegrityModule.kt",
      ),
      "utf8",
    )
    const policy = kotlin.slice(
      kotlin.indexOf("private fun isFeedbackSimulator()"),
      kotlin.indexOf("private fun encode("),
    )
    expect(policy).toContain("if (!BuildConfig.DEBUG) return false")
    expect(policy).toContain(
      "ApplicationInfo.FLAG_DEBUGGABLE) == 0) return false",
    )
    expect(policy).toContain(
      'Build.HARDWARE == "ranchu" || Build.HARDWARE == "goldfish"',
    )
    expect(policy).toContain('Build.PRODUCT.startsWith("sdk")')
    expect(policy).toContain("return tvMode && sdkEmulator")
    expect(kotlin).toContain("provider.request(")
    expect(
      fs.readFileSync(path.join(__dirname, "android/build.gradle"), "utf8"),
    ).toMatch(/buildFeatures\s*\{\s*buildConfig true/)
  })
})
