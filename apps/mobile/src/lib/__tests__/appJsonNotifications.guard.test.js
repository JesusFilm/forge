// Plain JS (like the other config guards here): the RN tsconfig has no Node
// types, and this guard reads app.json and installed package files off disk.
/* eslint-disable @typescript-eslint/no-require-imports */
/* global describe, expect, it, require, Buffer */
const fs = require("fs")
const zlib = require("zlib")
const path = require("path")

// U1/KTD1: lapse reminders are LOCAL notifications. Nothing at runtime can see
// what the build declared — the OS reads the entitlement and the merged
// manifest, both fixed at prebuild — so the declaration boundary is held here
// or nowhere.
//
// Verified against expo-notifications 57.0.19's plugin + native sources on
// 2026-09-16. Three premises live in a package this app never edits, and each
// one decides something this config depends on:
//
//   - `withNotificationsIOS` writes `aps-environment` UNCONDITIONALLY, from a
//     `mode` option that DEFAULTS TO 'development'. The plan accepts the
//     entitlement (KTD1) but the default value is a release-checklist item, not
//     a build defect: read it from the production archive, and set `mode` to
//     "production" if it reads development.
//   - `UIBackgroundModes: ['remote-notification']` is added ONLY when
//     `enableBackgroundRemoteNotifications` is truthy. Its ABSENCE below is
//     therefore load-bearing, not an oversight — this app registers no push
//     token and must not claim a background mode it never uses.
//   - `defaultChannel` writes the FCM `default_notification_channel_id`
//     metadata and CREATES NO CHANNEL. That is why KTD6 makes the adapter's
//     runtime `setNotificationChannelAsync` the load-bearing step, and why the
//     option is deliberately unset here rather than forgotten.
const PLUGIN = "expo-notifications"

// Exactly the options KTD1 pins. Android renders a notification icon from the
// ALPHA CHANNEL alone, so the source is a white mark on transparency. It is a
// DEDICATED asset, not the themed-launcher silhouette: that one is drawn for
// the 108dp adaptive canvas whose middle 72dp shows, so reusing it put the mark
// at 40.6% x 30.2% of the status-bar slot (measured 2026-09-16).
const EXPECTED_OPTIONS = {
  icon: "./assets/notification-icon.png",
  color: "#CB333B",
}

// The mark must fill most of its box. Below this it reads as a speck; a value
// near 1 would clip against the OS's own padding.
const MIN_MARK_WIDTH_FRACTION = 0.6

// Both must stay UNSET — see the premises above for what each one would turn on.
const FORBIDDEN_OPTION_KEYS = [
  "defaultChannel",
  "enableBackgroundRemoteNotifications",
]

// Google Play restricts these to alarm and calendar apps. R6 tolerates the
// module's own inexact-alarm fallback instead, so neither may ever appear.
const EXACT_ALARM_PERMISSIONS = [
  "android.permission.SCHEDULE_EXACT_ALARM",
  "android.permission.USE_EXACT_ALARM",
]

// The module's own manifest contributes this by merge. Blocking it would strip
// the runtime permission Android 13+ needs and make every schedule a silent
// no-op — the exact shape of the media-library trap next door.
const POST_NOTIFICATIONS = "android.permission.POST_NOTIFICATIONS"

// The module's Android build.gradle pulls both of these UNCONDITIONALLY, so the
// merged manifest carries far more than the two permissions above: a per-OEM
// launcher badge set (Samsung, Huawei, OPPO, Sony, HTC, ZUK, EvMe) plus
// READ_APP_BADGE from ShortcutBadger, and com.google.android.c2dm.permission
// .RECEIVE from firebase-messaging. None is a runtime permission, so none
// prompts anyone, and no Play policy bucket changes.
//
// SCOPE OF THAT CLAIM: the gradle lines and the merged list were both read on
// 2026-09-16 (40 permission entries). No baseline WITHOUT this module was
// captured, so which of the remaining entries are new is NOT established here —
// WAKE_LOCK and USE_FINGERPRINT in particular are also reachable through the
// play-services dependency the cast plugin already pulls. The two lines below
// are pinned so a version that drops or widens them is visible.
const TRANSITIVE_ANDROID_DEPENDENCIES = [
  "me.leolin:ShortcutBadger",
  "com.google.firebase:firebase-messaging",
]

const APP_ROOT = path.resolve(__dirname, "../../..")

function readAppJson() {
  return JSON.parse(fs.readFileSync(path.join(APP_ROOT, "app.json"), "utf8"))
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

/**
 * Alpha-channel bounding box of an RGBA PNG. Decoded here rather than measured
 * with an image library, because the repo ships none outside the generator.
 */
function markBounds(file) {
  const bytes = fs.readFileSync(file)
  let pos = 8
  let width = 0
  let height = 0
  const chunks = []
  while (pos < bytes.length) {
    const length = bytes.readUInt32BE(pos)
    const type = bytes.subarray(pos + 4, pos + 8).toString("ascii")
    if (type === "IHDR") {
      width = bytes.readUInt32BE(pos + 8)
      height = bytes.readUInt32BE(pos + 12)
      expect(bytes[pos + 8 + 9]).toBe(6) // colour type 6 = RGBA
    } else if (type === "IDAT") {
      chunks.push(bytes.subarray(pos + 8, pos + 8 + length))
    }
    pos += 12 + length
  }
  const raw = zlib.inflateSync(Buffer.concat(chunks))
  const stride = width * 4 + 1
  let previous = Buffer.alloc(width * 4)
  let minX = width
  let maxX = -1
  let minY = height
  let maxY = -1
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * stride]
    const line = Buffer.from(raw.subarray(y * stride + 1, (y + 1) * stride))
    for (let i = 0; i < line.length; i += 1) {
      const a = i >= 4 ? line[i - 4] : 0
      const b = previous[i]
      const c = i >= 4 ? previous[i - 4] : 0
      if (filter === 1) line[i] = (line[i] + a) & 0xff
      else if (filter === 2) line[i] = (line[i] + b) & 0xff
      else if (filter === 3) line[i] = (line[i] + ((a + b) >> 1)) & 0xff
      else if (filter === 4) {
        const p = a + b - c
        const pa = Math.abs(p - a)
        const pb = Math.abs(p - b)
        const pc = Math.abs(p - c)
        line[i] =
          (line[i] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 0xff
      }
    }
    previous = line
    for (let x = 0; x < width; x += 1) {
      if (line[x * 4 + 3] <= 8) continue
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }
  return {
    width,
    height,
    bounds: maxX === -1 ? null : { minX, maxX, minY, maxY },
  }
}

function readInstalled(relative) {
  const pkg = path.dirname(
    require.resolve(`${PLUGIN}/package.json`, { paths: [APP_ROOT] }),
  )
  return fs.readFileSync(path.join(pkg, relative), "utf8")
}

describe("the notifications plugin declares no more than local reminders need", () => {
  it("registers the plugin with exactly the pinned options", () => {
    const options = pluginOptions(readAppJson(), PLUGIN)

    // Anti-vacuous: a renamed or de-optioned entry would make every assertion
    // below read against null.
    expect(options).not.toBeNull()
    expect(options).toEqual(EXPECTED_OPTIONS)
  })

  it("leaves the two options that would widen the build unset", () => {
    const options = pluginOptions(readAppJson(), PLUGIN)

    // `toEqual` above already forbids extra keys; this names the two that
    // matter so the failure message points at the premise, not at a diff.
    for (const key of FORBIDDEN_OPTION_KEYS) {
      expect(options[key]).toBeUndefined()
    }
  })

  it("ships the notification icon it names, as a silhouette on transparency", () => {
    // A missing file fails the Android prebuild; a file with no alpha channel
    // builds fine and renders a solid square in the status bar.
    const bytes = fs.readFileSync(path.join(APP_ROOT, EXPECTED_OPTIONS.icon))
    expect(bytes.subarray(12, 16).toString("ascii")).toBe("IHDR")
    // Colour type 6 is RGBA. Android scales the source down, so the 1024px
    // master is comfortably past the 96px floor the plan sets.
    expect(bytes[25]).toBe(6)
    expect(bytes.readUInt32BE(16)).toBeGreaterThanOrEqual(96)
  })

  it("draws the mark large enough to read in the status bar", () => {
    // The layer that measures the real artifact rather than the intent. The
    // adaptive-launcher silhouette passes every other assertion in this file
    // and still renders the mark at 40% of the slot.
    const { width, height, bounds } = markBounds(
      path.join(APP_ROOT, EXPECTED_OPTIONS.icon),
    )

    expect(bounds).not.toBeNull()
    expect((bounds.maxX - bounds.minX + 1) / width).toBeGreaterThan(
      MIN_MARK_WIDTH_FRACTION,
    )
    // Not clipped. Deliberately NOT a centring check: the generator centres the
    // symbol on its CENTROID, not its bounding box, so a box-centred assertion
    // would fail the asset the design calls for (apps/mobile/CLAUDE.md).
    expect(bounds.minX).toBeGreaterThan(0)
    expect(bounds.maxX).toBeLessThan(width - 1)
    expect(bounds.minY).toBeGreaterThan(0)
    expect(bounds.maxY).toBeLessThan(height - 1)
  })

  it("measures the adaptive silhouette as too small (positive control)", () => {
    // Proves the rule above would have REJECTED the asset this branch first
    // shipped, rather than passing on any PNG with an alpha channel.
    const { width, bounds } = markBounds(
      path.join(APP_ROOT, "assets/adaptive-icon-monochrome.png"),
    )

    expect((bounds.maxX - bounds.minX + 1) / width).toBeLessThan(
      MIN_MARK_WIDTH_FRACTION,
    )
  })

  it("has the generator emit it at its own width, not the adaptive one", () => {
    // The generator runs by hand, so nothing executes this until someone
    // regenerates — by which time a reused constant has written a small mark.
    const generator = fs.readFileSync(
      path.join(APP_ROOT, "scripts/generate-app-icon.mjs"),
      "utf8",
    )

    expect(generator).toMatch(/const WIDTH_NOTIFICATION = 0\.\d+/)
    expect(generator).toMatch(
      /markSvg\(SIZE, WIDTH_NOTIFICATION, "#FFFFFF"\),\s*\n\s*path\.join\(ASSETS, "notification-icon\.png"\),/,
    )
  })

  it("requests no exact-alarm permission anywhere in the config", () => {
    // Read the WHOLE file, not just the permission arrays: `android.permissions`,
    // a plugin option and a manifest mod are three different places one could
    // land, and R6 forbids it in all of them.
    const source = fs.readFileSync(path.join(APP_ROOT, "app.json"), "utf8")

    for (const permission of EXACT_ALARM_PERMISSIONS) {
      expect(source).not.toContain(permission)
      // Also the bare name, which is how a plugin option would spell it.
      expect(source).not.toContain(
        permission.replace("android.permission.", ""),
      )
    }
  })

  it("does NOT block the notification permission the module contributes", () => {
    const blocked = readAppJson().expo.android?.blockedPermissions ?? []

    expect(blocked).not.toContain(POST_NOTIFICATIONS)
  })

  it("registers the plugin before expo-splash-screen", () => {
    // The repo's ordering rule (see plugins/withAndroidNavigationBar.js): Expo
    // runs mods last-registered-first, and expo-splash-screen REPLACES rather
    // than merges. Leaf modules sit ahead of it.
    const config = readAppJson()
    const splash = pluginIndex(config, "expo-splash-screen")

    expect(splash).toBeGreaterThanOrEqual(0)
    expect(pluginIndex(config, PLUGIN)).toBeLessThan(splash)
  })

  it("upstream premise: the iOS plugin always writes aps-environment", () => {
    // The entitlement KTD1 accepts. Pinned because its DEFAULT is the release
    // checklist item: if a production archive reads `development`, the fix is
    // this plugin's `mode` option, not a rebuild.
    const source = readInstalled("plugin/build/withNotificationsIOS.js")

    expect(source).toContain("'aps-environment'")
    expect(source).toMatch(/mode\s*=\s*'development'/)
  })

  it("upstream premise: a background mode needs the option we leave unset", () => {
    // What makes the absent key above a decision. If a future version starts
    // adding the mode unconditionally, this goes red and the config is wrong.
    const source = readInstalled("plugin/build/withNotificationsIOS.js")
    const guard = source.indexOf("if (!enableBackgroundRemoteNotifications)")

    expect(guard).toBeGreaterThan(-1)
    expect(source.indexOf("UIBackgroundModes")).toBeGreaterThan(guard)
  })

  it("upstream premise: the module's manifest carries the two permissions", () => {
    // Neither is declared by hand — they arrive by merge, which is why
    // `blockedPermissions` is the only thing that could take them away.
    const manifest = readInstalled("android/src/main/AndroidManifest.xml")

    expect(manifest).toContain(POST_NOTIFICATIONS)
    expect(manifest).toContain("android.permission.RECEIVE_BOOT_COMPLETED")
    // R7's boot receiver: it is what reschedules pending reminders after a
    // restart, and it is the module's, not ours.
    expect(manifest).toContain("android.intent.action.BOOT_COMPLETED")
    for (const permission of EXACT_ALARM_PERMISSIONS) {
      expect(manifest).not.toContain(permission)
    }
  })

  it("upstream premise: the module pulls the badge and messaging AARs", () => {
    // What makes the merged permission list far longer than the module's own
    // manifest. Verified against a real `:app:processDebugMainManifest` merge
    // on 2026-09-16 (expo-notifications 57.0.19): POST_NOTIFICATIONS and
    // RECEIVE_BOOT_COMPLETED both present, no exact-alarm entry, and no
    // READ_MEDIA_* entry surviving the block list.
    const gradle = readInstalled("android/build.gradle")

    for (const dependency of TRANSITIVE_ANDROID_DEPENDENCIES) {
      expect(gradle).toContain(dependency)
    }
  })

  it("upstream premise: the Android delegate falls back to inexact alarms", () => {
    // R6 accepts late delivery precisely BECAUSE this branch exists. Without
    // it, no exact-alarm permission would mean no delivery at all.
    const source = readInstalled(
      "android/src/main/java/expo/modules/notifications/service/delegates/ExpoSchedulingDelegate.kt",
    )

    expect(source).toContain("canScheduleExactAlarms()")
    expect(source).toContain("setAndAllowWhileIdle")
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

    expect(pluginOptions(stripped, PLUGIN)).not.toEqual(EXPECTED_OPTIONS)
    expect(pluginOptions(stripped, PLUGIN).icon).toBeUndefined()
    expect(pluginOptions(stripped, "expo-image")).toBeNull()
    expect(pluginIndex(stripped, "expo-splash-screen")).toBe(-1)
    expect(stripped.expo.android.blockedPermissions ?? []).toHaveLength(0)
  })
})
