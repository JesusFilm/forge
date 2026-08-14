// Plain JS (like the other guards): the RN tsconfig has no Node types, and
// this one reads app.json and drives a config plugin through fs/path.
/* eslint-disable @typescript-eslint/no-require-imports */
/* global describe, expect, it, require */
const fs = require("fs")
const path = require("path")

/**
 * R15's BUILD-TIME half (U9).
 *
 * `isPictureInPictureSupported()` inspects no manifest, so the runtime gate in
 * `pictureInPicture.ts` cannot tell an activity that may enter the operating
 * system's window from one that may not. Only the generated manifest can, and
 * `android/` is gitignored — no test may read it and still be honest on CI.
 *
 * So this guard asserts the two things that DO travel with the repo:
 *
 *   1. app.json still asks the expo-video plugin for picture-in-picture. That
 *      is the one-line revert which would leave four surfaces presenting an
 *      affordance the manifest cannot honour, with every other test green.
 *   2. The REAL plugin, driven by the REAL app.json options, writes
 *      `android:supportsPictureInPicture` onto the main activity — with a
 *      negative control, so a no-op change fails.
 *
 * The activity's `configChanges` list comes from the Expo template rather than
 * from this plugin, so it is RECORDED below from a real prebuild and
 * cross-checked opportunistically. See ANDROID_CONFIG_CHANGES.
 */

const APP_ROOT = path.resolve(__dirname, "..", "..", "..", "..")

/**
 * The main activity's `android:configChanges`, verbatim from
 * `android/app/src/main/AndroidManifest.xml` after
 * `npx expo prebuild --platform android --clean` on 2026-08-15
 * (expo 57.0.12, expo-video 57.0.2, react-native 0.86.2).
 *
 * Android recreates an activity entering picture-in-picture unless the four
 * entries in REQUIRED_CONFIG_CHANGES are declared. All four are present, so
 * this app needs NO local config plugin for them.
 */
const ANDROID_CONFIG_CHANGES =
  "keyboard|keyboardHidden|orientation|screenSize|screenLayout|uiMode|smallestScreenSize|assetsPaths"

/** What Android requires before it will keep the activity across the mode. */
const REQUIRED_CONFIG_CHANGES = [
  "orientation",
  "screenSize",
  "screenLayout",
  "smallestScreenSize",
]

const GENERATED_MANIFEST = path.join(
  APP_ROOT,
  "android",
  "app",
  "src",
  "main",
  "AndroidManifest.xml",
)

function appJson() {
  return JSON.parse(fs.readFileSync(path.join(APP_ROOT, "app.json"), "utf8"))
}

/** The options app.json hands the expo-video config plugin. */
function expoVideoPluginOptions() {
  const plugins = appJson().expo.plugins
  const entry = plugins.find(
    (plugin) => Array.isArray(plugin) && plugin[0] === "expo-video",
  )
  expect(entry).toBeDefined()
  return entry[1]
}

/** A main activity shaped like the one the Expo template generates. */
function templateManifest() {
  return {
    manifest: {
      $: { "xmlns:android": "http://schemas.android.com/apk/res/android" },
      application: [
        {
          $: { "android:name": ".MainApplication" },
          activity: [
            {
              $: {
                "android:name": ".MainActivity",
                "android:configChanges": ANDROID_CONFIG_CHANGES,
                "android:launchMode": "singleTask",
              },
              "intent-filter": [
                {
                  action: [
                    { $: { "android:name": "android.intent.action.MAIN" } },
                  ],
                  category: [
                    {
                      $: {
                        "android:name": "android.intent.category.LAUNCHER",
                      },
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  }
}

/** Run the real plugin's android mod and return the main activity's attrs. */
async function activityAttributesFor(options) {
  const withExpoVideo = require("expo-video/plugin/build/withExpoVideo").default
  const config = withExpoVideo({ name: "forge-watch", slug: "x" }, options)
  const applied = await config.mods.android.manifest({
    name: "forge-watch",
    slug: "x",
    modResults: templateManifest(),
    modRequest: {},
  })
  return applied.modResults.manifest.application[0].activity[0].$
}

/** Run the real plugin's iOS mod over an Info.plist that already has audio. */
async function backgroundModesFor(options) {
  const withExpoVideo = require("expo-video/plugin/build/withExpoVideo").default
  const config = withExpoVideo({ name: "forge-watch", slug: "x" }, options)
  const applied = await config.mods.ios.infoPlist({
    name: "forge-watch",
    slug: "x",
    modResults: { UIBackgroundModes: ["audio"] },
    modRequest: {},
  })
  return applied.modResults.UIBackgroundModes
}

describe("app.json asks for picture-in-picture", () => {
  it("sets supportsPictureInPicture on the expo-video plugin", () => {
    expect(expoVideoPluginOptions().supportsPictureInPicture).toBe(true)
  })

  it("keeps background playback on, which the same flag depends on", () => {
    // The plugin enables the iOS `audio` background mode from EITHER flag.
    // Dropping this one would still leave picture-in-picture configured, so
    // the pair is asserted rather than inferred.
    expect(expoVideoPluginOptions().supportsBackgroundPlayback).toBe(true)
  })
})

describe("the generated Android manifest", () => {
  it("puts supportsPictureInPicture on the main activity", async () => {
    const attributes = await activityAttributesFor(expoVideoPluginOptions())

    expect(attributes["android:supportsPictureInPicture"]).toBe("true")
  })

  it("negative control: without the flag the attribute is absent", async () => {
    // The whole point of running the real plugin. Asserting only the app.json
    // key above would stay green if expo-video ever stopped writing it.
    const attributes = await activityAttributesFor({
      supportsBackgroundPlayback: true,
    })

    expect(attributes["android:supportsPictureInPicture"]).toBeUndefined()
  })

  it("negative control: an explicit false removes the attribute", async () => {
    const attributes = await activityAttributesFor({
      supportsBackgroundPlayback: true,
      supportsPictureInPicture: false,
    })

    expect(attributes["android:supportsPictureInPicture"]).toBeUndefined()
  })

  it("declares every config change picture-in-picture needs", () => {
    // RECORDED, not read from android/ — that directory is gitignored, so a CI
    // run has none. The cross-check below is what keeps the record honest.
    const declared = ANDROID_CONFIG_CHANGES.split("|")

    for (const required of REQUIRED_CONFIG_CHANGES)
      expect(declared).toContain(required)
  })

  it("matches the generated manifest when one is present", () => {
    // Opportunistic on purpose: it runs on a machine that has prebuilt and is
    // skipped on CI. A green CI run is therefore NOT evidence that the
    // generated file was read — the recorded string above is, and this is what
    // catches it going stale.
    if (!fs.existsSync(GENERATED_MANIFEST)) return

    const xml = fs.readFileSync(GENERATED_MANIFEST, "utf8")

    expect(xml).toContain(`android:configChanges="${ANDROID_CONFIG_CHANGES}"`)
    expect(xml).toContain('android:supportsPictureInPicture="true"')
  })
})

describe("the iOS Info.plist", () => {
  it("is unchanged by the flag, because background playback already set it", async () => {
    // The plan asserts this in prose. The plugin derives the `audio` mode from
    // EITHER flag, so with background playback already on, adding
    // picture-in-picture is a no-op — measured here rather than believed.
    const withFlag = await backgroundModesFor(expoVideoPluginOptions())
    const withoutFlag = await backgroundModesFor({
      supportsBackgroundPlayback: true,
    })

    expect(withFlag).toEqual(withoutFlag)
    expect(withFlag).toEqual(["audio"])
  })

  it("positive control: the mod does write when both flags are off", async () => {
    // Without this the case above passes on a mod that does nothing at all.
    const modes = await backgroundModesFor({
      supportsBackgroundPlayback: false,
      supportsPictureInPicture: false,
    })

    expect(modes).toEqual([])
  })
})
