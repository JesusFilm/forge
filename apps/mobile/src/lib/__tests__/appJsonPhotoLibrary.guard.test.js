// Plain JS (like the other config guards here): the RN tsconfig has no Node
// types, and this guard reads app.json off disk.
/* eslint-disable @typescript-eslint/no-require-imports */
/* global describe, expect, it, require */
const fs = require("fs")
const path = require("path")

// U1/KTD7: raw file export asks the device photo library to ADD a video and
// never to read one. Nothing at runtime can check the scope it was granted —
// the OS decides that from the manifest and the Info.plist — so the boundary is
// held here or nowhere.
//
// Verified against expo-media-library 57.0.4's plugin + native sources on
// 2026-09-09:
//   - `withMediaLibrary` calls `IOSConfig.Permissions.createPermissionsPlugin`
//     with BOTH photo-library strings as defaults, and `applyPermissions` only
//     deletes a key when the option is EXACTLY `false`. Omitting
//     `photosPermission` therefore SHIPS the full-access
//     `NSPhotoLibraryUsageDescription` — hence the `false` below, not an absent
//     key. This is the trap U1 existed to find.
//   - The Android plugin hardcodes READ_EXTERNAL_STORAGE,
//     WRITE_EXTERNAL_STORAGE and READ_MEDIA_VISUAL_USER_SELECTED into
//     `expo.android.permissions` regardless of options, and the library's own
//     AndroidManifest.xml contributes the same three by merge. Only
//     `blockedPermissions` (which emits `tools:node="remove"`) can strip a
//     merged entry, so `granularPermissions: []` alone is not sufficient.
//
// WRITE_EXTERNAL_STORAGE is deliberately NOT blocked: on API <= 32
// `MediaLibraryModule.requireSystemPermissions()` needs it granted, so blocking
// it would kill export on every Android 12-and-below device.
//
// It stays off Android 13+ because Expo's OWN Android manifest template already
// declares it `android:maxSdkVersion="32" tools:replace="android:maxSdkVersion"`,
// and `setAndroidPermissions` matches on `android:name` alone — so the library
// plugin's bare entry is recognised as already-requested and adds no unscoped
// duplicate. Confirmed against a real `expo prebuild` on 2026-09-09: the
// generated manifest carries the scoped entry with and without any local mod of
// ours, which is why no local config plugin ships for it. That template line is
// an UPSTREAM premise this app depends on and cannot see, so it is pinned below.
const PLUGIN = "expo-media-library"

const IOS_ADD_ONLY_KEY = "savePhotosPermission"
const IOS_FULL_ACCESS_KEY = "photosPermission"

// Every media READ the library can contribute. READ_MEDIA_VIDEO alone would put
// the app in Play's photo-and-video policy bucket.
const BLOCKED_PERMISSIONS = [
  "android.permission.READ_MEDIA_IMAGES",
  "android.permission.READ_MEDIA_VIDEO",
  "android.permission.READ_MEDIA_AUDIO",
  "android.permission.READ_MEDIA_VISUAL_USER_SELECTED",
  "android.permission.READ_EXTERNAL_STORAGE",
  "android.permission.ACCESS_MEDIA_LOCATION",
]

const WRITE_PERMISSION = "android.permission.WRITE_EXTERNAL_STORAGE"

/**
 * Expo's Android manifest template, read from the installed package rather than
 * from a copy — a copy would pass forever while the real template changed.
 */
function readAndroidManifestTemplateSource() {
  const appRoot = path.resolve(__dirname, "../../..")
  const expoConfigPlugins = require.resolve("expo/config-plugins", {
    paths: [appRoot],
  })
  const baseMods = require.resolve(
    "@expo/config-plugins/build/plugins/withAndroidBaseMods.js",
    { paths: [path.dirname(expoConfigPlugins)] },
  )
  return fs.readFileSync(baseMods, "utf8")
}

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

/** Index of a plugin entry in either its bare-string or [name, options] form. */
function pluginIndex(config, name) {
  const entries = config.expo.plugins ?? []
  return entries.findIndex((entry) =>
    Array.isArray(entry) ? entry[0] === name : entry === name,
  )
}

describe("the photo-library scope is add-only on both platforms", () => {
  it("configures the iOS add-only string and DELETES the full-access one", () => {
    const options = pluginOptions(readAppJson(), PLUGIN)

    // Anti-vacuous: a renamed or de-optioned plugin entry would make every
    // assertion below read against null.
    expect(options).not.toBeNull()

    expect(typeof options[IOS_ADD_ONLY_KEY]).toBe("string")
    expect(options[IOS_ADD_ONLY_KEY].length).toBeGreaterThan(0)
    // Exactly `false`, not merely absent — absent means the plugin's own
    // full-access default gets written into the Info.plist.
    expect(options[IOS_FULL_ACCESS_KEY]).toBe(false)
  })

  it("requests no Android media-read permission", () => {
    const options = pluginOptions(readAppJson(), PLUGIN)

    expect(options.granularPermissions).toEqual([])
    expect(options.isAccessMediaLocationEnabled).toBe(false)
  })

  it("blocks every media-read entry the merge can contribute", () => {
    const blocked = readAppJson().expo.android?.blockedPermissions ?? []

    for (const permission of BLOCKED_PERMISSIONS) {
      expect(blocked).toContain(permission)
    }
  })

  it("does NOT block the legacy write permission", () => {
    // Blocking this is the reading of KTD7 that kills export on Android <= 12.
    const blocked = readAppJson().expo.android?.blockedPermissions ?? []

    expect(blocked).not.toContain(WRITE_PERMISSION)
  })

  it("upstream premise: Expo's manifest template scopes that write permission", () => {
    // The ONLY thing keeping WRITE_EXTERNAL_STORAGE off Android 13+, and it
    // lives in a package this app never edits. An Expo upgrade that drops the
    // attribute would silently declare the permission at every API level; this
    // is the layer that claim can actually be checked at.
    const source = readAndroidManifestTemplateSource()
    const line = source
      .split("\n")
      .find((l) =>
        l.includes(WRITE_PERMISSION.replace("android.permission.", "")),
      )

    expect(line).toBeDefined()
    expect(line).toContain('android:maxSdkVersion="32"')
  })

  it("registers the library plugin before expo-splash-screen", () => {
    // The repo's ordering rule (see plugins/withAndroidNavigationBar.js): Expo
    // runs mods last-registered-first, and expo-splash-screen REPLACES rather
    // than merges. Leaf modules sit ahead of it.
    const config = readAppJson()
    const splash = pluginIndex(config, "expo-splash-screen")

    expect(splash).toBeGreaterThanOrEqual(0)
    expect(pluginIndex(config, PLUGIN)).toBeLessThan(splash)
  })

  it("negative control: the readers report absence, not a default", () => {
    // Proves each assertion above would actually fail if its key were dropped,
    // rather than passing against an undefined the matcher tolerates.
    const stripped = {
      expo: {
        plugins: ["expo-router", [PLUGIN, {}], "expo-image"],
        android: {},
      },
    }

    expect(pluginOptions(stripped, PLUGIN)[IOS_FULL_ACCESS_KEY]).toBeUndefined()
    expect(pluginOptions(stripped, PLUGIN)[IOS_ADD_ONLY_KEY]).toBeUndefined()
    expect(pluginOptions(stripped, PLUGIN).granularPermissions).toBeUndefined()
    expect(pluginOptions(stripped, "expo-image")).toBeNull()
    expect(pluginIndex(stripped, "expo-splash-screen")).toBe(-1)
    expect(stripped.expo.android.blockedPermissions ?? []).toHaveLength(0)
  })
})
