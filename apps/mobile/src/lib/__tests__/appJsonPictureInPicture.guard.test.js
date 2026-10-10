// Plain JS (like the other config guards here): the RN tsconfig has no Node
// types, and this guard reads app.json off disk.
/* eslint-disable @typescript-eslint/no-require-imports */
/* global describe, expect, it, require */
const fs = require("fs")
const path = require("path")

// U9/R15: the picture-in-picture props on the app's video views are honourable
// only because this plugin entry configures both platforms. Nothing at runtime
// can check it — `isPictureInPictureSupported()` reads the DEVICE, never the
// manifest — so the pairing is held here or nowhere.
//
// Verified against expo-video 57.0.2's plugin source and one prebuild pair on
// 2026-08-18: with the flag the generated AndroidManifest.xml carries
// `android:supportsPictureInPicture="true"` on `.MainActivity`; without it, the
// attribute is absent. The iOS Info.plist is identical either way, because the
// plugin adds the `audio` background mode when EITHER option is set and
// `supportsBackgroundPlayback` already sets it.
const PLUGIN = "expo-video"
const FLAG = "supportsPictureInPicture"

function readAppJson() {
  const file = path.resolve(__dirname, "../../../app.json")
  return JSON.parse(fs.readFileSync(file, "utf8"))
}

/** The plugin's options object, or null when the entry carries none. */
function pluginOptions(config, name) {
  const entries = config.expo.plugins ?? []
  for (const entry of entries) {
    if (!Array.isArray(entry)) continue
    if (entry[0] !== name) continue
    return entry[1] ?? null
  }
  return null
}

describe("the expo-video plugin configures picture-in-picture", () => {
  it("carries the flag, alongside the background playback it already had", () => {
    const options = pluginOptions(readAppJson(), PLUGIN)

    // Anti-vacuous: a renamed plugin entry would make every assertion below
    // read against null.
    expect(options).not.toBeNull()
    expect(options[FLAG]).toBe(true)
    expect(options.supportsBackgroundPlayback).toBe(true)
  })

  it("negative control: the reader returns the flag's absence, not a default", () => {
    const stripped = {
      expo: {
        plugins: [
          "expo-router",
          [PLUGIN, { supportsBackgroundPlayback: true }],
          "expo-image",
        ],
      },
    }

    expect(pluginOptions(stripped, PLUGIN)[FLAG]).toBeUndefined()
    expect(pluginOptions(stripped, "expo-image")).toBeNull()
  })
})
