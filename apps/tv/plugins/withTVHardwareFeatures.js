/* global require, module */
/* eslint-disable @typescript-eslint/no-require-imports */
const { withAndroidManifest } = require("expo/config-plugins")

module.exports = function withTVHardwareFeatures(config) {
  return withAndroidManifest(config, (mod) => {
    const manifest = mod.modResults.manifest
    manifest["uses-feature"] ??= []
    // Override Play's hardware requirements implied by scanner/audio dependencies.
    for (const name of [
      "android.hardware.screen.portrait",
      "android.hardware.microphone",
    ]) {
      const feature = manifest["uses-feature"].find(
        (entry) => entry.$["android:name"] === name,
      )
      if (feature) {
        feature.$["android:required"] = "false"
      } else {
        manifest["uses-feature"].push({
          $: { "android:name": name, "android:required": "false" },
        })
      }
    }
    return mod
  })
}
