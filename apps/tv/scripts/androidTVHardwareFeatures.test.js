/* global require, jest, describe, it, expect */
/* eslint-disable @typescript-eslint/no-require-imports */
jest.mock("expo/config-plugins", () => ({
  withAndroidManifest: (_config, action) => action,
}))

const withTVHardwareFeatures = require("../plugins/withTVHardwareFeatures")
const appConfig = require("../app.json")

describe("Android TV Play hardware filters", () => {
  it("makes portrait and microphone optional without removing audio permission", () => {
    const manifest = {
      "uses-permission": [
        { $: { "android:name": "android.permission.RECORD_AUDIO" } },
      ],
    }
    withTVHardwareFeatures({})({ modResults: { manifest } })
    expect(manifest["uses-feature"]).toEqual([
      {
        $: {
          "android:name": "android.hardware.screen.portrait",
          "android:required": "false",
        },
      },
      {
        $: {
          "android:name": "android.hardware.microphone",
          "android:required": "false",
        },
      },
    ])
    expect(manifest["uses-permission"]).toEqual([
      { $: { "android:name": "android.permission.RECORD_AUDIO" } },
    ])
  })

  it("overrides existing requirements, preserves other features, and is idempotent", () => {
    const manifest = {
      "uses-feature": [
        {
          $: {
            "android:name": "android.hardware.screen.portrait",
            "android:required": "true",
          },
        },
        { $: { "android:name": "android.hardware.microphone" } },
        {
          $: {
            "android:name": "android.software.leanback",
            "android:required": "true",
          },
        },
      ],
    }
    const mod = { modResults: { manifest } }
    const apply = withTVHardwareFeatures({})
    apply(mod)
    const once = JSON.stringify(manifest)
    apply(mod)
    expect(JSON.stringify(manifest)).toBe(once)
    expect(
      manifest["uses-feature"].map((entry) => entry.$["android:required"]),
    ).toEqual(["false", "false", "true"])
  })

  it("registers the manifest fix in the TV prebuild configuration", () => {
    expect(appConfig.expo.plugins).toContain("./plugins/withTVHardwareFeatures")
  })
})
