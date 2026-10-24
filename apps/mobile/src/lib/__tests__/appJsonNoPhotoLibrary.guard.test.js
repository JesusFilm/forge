// Plain JS (like the other config guards here): the RN tsconfig has no Node
// types, and this guard reads app.json and package.json off disk.
/* eslint-disable @typescript-eslint/no-require-imports */
/* global describe, expect, it, require */
const fs = require("fs")
const path = require("path")

// Raw file export saves into a folder the viewer picks, so the app needs NO
// photo-library access at all. Nothing at runtime can check that: the OS reads
// the manifest and the Info.plist, both generated from app.json.
const FORBIDDEN_PLUGIN = "expo-media-library"

// Absence from app.json removes nothing. Expo's base manifest template declares
// both legacy storage permissions unconditionally, and expo-file-system and
// expo-image contribute their own, so `blockedPermissions` is the only lever.
const FORBIDDEN_ANDROID_PERMISSIONS = [
  "android.permission.READ_MEDIA_IMAGES",
  "android.permission.READ_MEDIA_VIDEO",
  "android.permission.READ_MEDIA_AUDIO",
  "android.permission.READ_MEDIA_VISUAL_USER_SELECTED",
  "android.permission.READ_EXTERNAL_STORAGE",
  "android.permission.WRITE_EXTERNAL_STORAGE",
  "android.permission.ACCESS_MEDIA_LOCATION",
]

const FORBIDDEN_INFO_PLIST_KEYS = [
  "NSPhotoLibraryUsageDescription",
  "NSPhotoLibraryAddUsageDescription",
]

// The export stages into `Documents/`, so either key would expose a half-written
// file and let a viewer delete one mid-transfer. The saved copy reaches the
// Files app through the picker instead.
const FORBIDDEN_FILE_SHARING_KEYS = [
  "UIFileSharingEnabled",
  "LSSupportsOpeningDocumentsInPlace",
]

function readJson(relative) {
  return JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "..", "..", relative), "utf8"),
  )
}

/** Every plugin name, whether the entry is a bare string or a [name, options]. */
function pluginNames(config) {
  return (config.expo.plugins ?? []).map((entry) =>
    Array.isArray(entry) ? entry[0] : entry,
  )
}

/** The permissions app.json strips out of the merged Android manifest. */
function blockedAndroidPermissions(config) {
  return config.expo.android?.blockedPermissions ?? []
}

function infoPlistKeys(config) {
  return Object.keys(config.expo.ios?.infoPlist ?? {})
}

function dependencyNames(manifest) {
  return Object.keys({ ...manifest.dependencies, ...manifest.devDependencies })
}

describe("the app declares no photo-library access", () => {
  const appJson = readJson("app.json")
  const packageJson = readJson("package.json")

  it("registers no photo-library config plugin", () => {
    expect(pluginNames(appJson)).not.toContain(FORBIDDEN_PLUGIN)
  })

  it("does not depend on the photo-library package", () => {
    expect(dependencyNames(packageJson)).not.toContain(FORBIDDEN_PLUGIN)
  })

  it("blocks every media permission on Android", () => {
    const blocked = blockedAndroidPermissions(appJson)
    for (const permission of FORBIDDEN_ANDROID_PERMISSIONS) {
      expect(blocked).toContain(permission)
    }
  })

  it("declares no photo usage string on iOS", () => {
    const keys = infoPlistKeys(appJson)
    for (const key of FORBIDDEN_INFO_PLIST_KEYS) {
      expect(keys).not.toContain(key)
    }
  })

  it("keeps the staging root out of the Files app", () => {
    const keys = infoPlistKeys(appJson)
    for (const key of FORBIDDEN_FILE_SHARING_KEYS) {
      expect(keys).not.toContain(key)
    }
  })

  describe("positive controls: each reader can report a re-added declaration", () => {
    it("reads a plugin name in either entry shape", () => {
      expect(
        pluginNames({ expo: { plugins: [[FORBIDDEN_PLUGIN, {}]] } }),
      ).toEqual([FORBIDDEN_PLUGIN])
      expect(pluginNames({ expo: { plugins: [FORBIDDEN_PLUGIN] } })).toEqual([
        FORBIDDEN_PLUGIN,
      ])
      expect(pluginNames({ expo: {} })).toEqual([])
    })

    it("reads the package from either dependency map", () => {
      expect(
        dependencyNames({ dependencies: { [FORBIDDEN_PLUGIN]: "~18.2.0" } }),
      ).toEqual([FORBIDDEN_PLUGIN])
      expect(
        dependencyNames({ devDependencies: { [FORBIDDEN_PLUGIN]: "~18.2.0" } }),
      ).toEqual([FORBIDDEN_PLUGIN])
      expect(dependencyNames({})).toEqual([])
    })

    it("reports a partly blocked list as itself, not as the full set", () => {
      const partial = ["android.permission.READ_MEDIA_VIDEO"]
      expect(
        blockedAndroidPermissions({
          expo: { android: { blockedPermissions: partial } },
        }),
      ).toEqual(partial)
      expect(blockedAndroidPermissions({ expo: { android: {} } })).toEqual([])
      expect(blockedAndroidPermissions({ expo: {} })).toEqual([])
    })

    it("reads a photo usage string and a file-sharing key", () => {
      expect(
        infoPlistKeys({
          expo: {
            ios: {
              infoPlist: {
                NSPhotoLibraryAddUsageDescription: "This saves your video.",
              },
            },
          },
        }),
      ).toEqual(["NSPhotoLibraryAddUsageDescription"])
      expect(
        infoPlistKeys({
          expo: { ios: { infoPlist: { UIFileSharingEnabled: true } } },
        }),
      ).toEqual(["UIFileSharingEnabled"])
      expect(infoPlistKeys({ expo: {} })).toEqual([])
    })
  })
})
