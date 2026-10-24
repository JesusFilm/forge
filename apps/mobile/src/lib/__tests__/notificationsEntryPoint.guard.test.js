// Plain JS (like the other guards here): the RN tsconfig has no Node types,
// and this guard reads installed package files off disk.
/* eslint-disable @typescript-eslint/no-require-imports */
/* global describe, expect, it, require */
const fs = require("fs")
const path = require("path")

// Guard: KTD1 puts every notifications call behind ONE adapter, so the whole
// feature's mocked-versus-real seam is a single file. That design makes the
// lifecycle suite fast and total — and it means the suite stays green when the
// module underneath stops supplying a call the adapter names. This guard is the
// layer that can see that.
//
// The last-response pair is the sharpest case. 57.0.19 ships FOUR functions for
// two jobs, and the `*Async` halves are `@deprecated`:
//
//   getLastNotificationResponseAsync  (deprecated) -> getLastNotificationResponse
//   clearLastNotificationResponseAsync(deprecated) -> clearLastNotificationResponse
//
// Both spellings exist, both typecheck, and both work today, so nothing else in
// this repo would notice the adapter binding the pair scheduled for removal.
//
// Four independent layers, following mediaLibraryEntryPoint.guard.test.js: the
// runtime capability (does the installed module actually supply every call),
// the version floor, the upstream premise (is the deprecation split still the
// shape the adapter was written against), and the wiring (does the adapter name
// the specifier, and neither deprecated spelling).
//
// The sync name is a PREFIX of the deprecated one, so a presence check on
// `getLastNotificationResponse` passes on the async spelling too. Only the
// absence check, and the trailing paren, separate them.

const APP_ROOT = path.resolve(__dirname, "../../..")
const SPECIFIER = "expo-notifications"
const ADAPTER = "src/lib/lapseReminders/notificationsAdapter.ts"

// 57.0.17 carries the iOS last-response fix the plan depends on for the cold
// tap. `npx expo install` pins the SDK line; this pins the patch.
const MINIMUM_VERSION = [57, 0, 17]

/** Exactly the calls the adapter makes (U4/KTD1, plus U7's push port). */
const REQUIRED_CALLS = [
  // Channel first: Android 13 shows no permission prompt until one exists (KTD6).
  // The same call creates U7's announcements channel (KTD9).
  "setNotificationChannelAsync",
  // U7/KTD9's push port: the token read and the rotation subscription.
  "getExpoPushTokenAsync",
  "addPushTokenListener",
  "getPermissionsAsync",
  "requestPermissionsAsync",
  "scheduleNotificationAsync",
  "cancelScheduledNotificationAsync",
  // U8/KTD13: BY IDENTIFIER. The tray is shared with announcements, so the
  // dismiss-all spelling below is banned rather than merely unused.
  "dismissNotificationAsync",
  // Development-only read, used by U7 to prove same-identifier replacement.
  "getAllScheduledNotificationsAsync",
  "getLastNotificationResponse",
  "clearLastNotificationResponse",
  "addNotificationResponseReceivedListener",
  // Suppresses presentation while the app is open (KTD1).
  "setNotificationHandler",
]

/** The deprecated spellings the adapter must NOT bind. */
const DEPRECATED_CALLS = [
  "getLastNotificationResponseAsync",
  "clearLastNotificationResponseAsync",
]

/**
 * Calls the adapter must NOT bind although the module supplies them. U8/KTD13:
 * dismiss-all empties a tray the announcements share, so an announcement the
 * viewer has not opened yet would vanish on the next reminder pass (AE21). The
 * lifecycle suite catches that through its fake; this catches the adapter
 * reaching for the module's own whole-tray call.
 */
const FORBIDDEN_CALLS = ["dismissAllNotificationsAsync"]

/**
 * Exactly the packages the adapter may import (KTD9 admits the second one: the
 * Expo token read needs the EAS project id, which lives in the app config).
 * Pinned because this file is the app's ONE native-notification seam, and a
 * third package here would widen it without any behavioural suite noticing.
 */
const ALLOWED_PACKAGES = ["expo-notifications", "expo-constants"]

function readInstalled(relative) {
  const pkg = path.dirname(
    require.resolve(`${SPECIFIER}/package.json`, { paths: [APP_ROOT] }),
  )
  return fs.readFileSync(path.join(pkg, relative), "utf8")
}

/** Strip comments so a mention inside prose cannot satisfy or trip a rule. */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1")
}

function readAdapterSource() {
  return stripComments(fs.readFileSync(path.join(APP_ROOT, ADAPTER), "utf8"))
}

function installedVersion() {
  return require(
    require.resolve(`${SPECIFIER}/package.json`, { paths: [APP_ROOT] }),
  ).version
}

/** [major, minor, patch] from a semver string, ignoring any pre-release tag. */
function parseVersion(version) {
  return version
    .split("-")[0]
    .split(".")
    .map((part) => Number.parseInt(part, 10))
}

/**
 * The JSDoc block immediately above a declaration, or null when it has none.
 * A plain `@deprecated .* export declare` regex cannot do this: the marker is
 * not the last line of the block (`@return` follows it on the clear call), and
 * a `[^*]*` bridge stops at the next comment line's own asterisk.
 */
function docBlockFor(source, call) {
  const declaration = source.indexOf(`export declare function ${call}(`)
  if (declaration === -1) return null
  const close = source.lastIndexOf("*/", declaration)
  if (close === -1) return null
  // Anything but whitespace between the block and the declaration means the
  // block documents something else.
  if (source.slice(close + 2, declaration).trim() !== "") return null
  const open = source.lastIndexOf("/**", close)
  if (open === -1) return null
  return source.slice(open, close + 2)
}

/** Every non-relative module a source imports or requires, in source order. */
function packageImports(source) {
  const specifiers = [
    ...source.matchAll(/^\s*import\s[\s\S]*?from\s+["']([^"']+)["']/gm),
    ...source.matchAll(/^\s*import\s+["']([^"']+)["']/gm),
    ...source.matchAll(/\brequire\s*\(\s*["']([^"']+)["']\s*\)/g),
  ].map((match) => match[1])
  return specifiers.filter((specifier) => !specifier.startsWith("."))
}

/** True when `version` is at or above `floor`, compared part by part. */
function meetsFloor(version, floor) {
  const parts = parseVersion(version)
  for (let i = 0; i < floor.length; i += 1) {
    const part = parts[i]
    if (!Number.isFinite(part)) return false
    if (part > floor[i]) return true
    if (part < floor[i]) return false
  }
  return true
}

describe("the notifications adapter imports a module that supplies its calls", () => {
  it("the module this app imports really supplies every call it makes", () => {
    // The strongest layer: resolve the module and look at what is there, rather
    // than trusting a specifier string or a type declaration.
    const notifications = require(SPECIFIER)

    for (const call of REQUIRED_CALLS) {
      expect(typeof notifications[call]).toBe("function")
    }
  })

  it("supplies a DATE trigger, which is the only kind reminders use", () => {
    // R6 snaps to an absolute local instant. An interval trigger would drift
    // across a daylight-saving change and a calendar trigger would repeat.
    const notifications = require(SPECIFIER)

    expect(notifications.SchedulableTriggerInputTypes?.DATE).toBe("date")
  })

  it("is installed at or above the version the plan pins", () => {
    expect(meetsFloor(installedVersion(), MINIMUM_VERSION)).toBe(true)
  })

  it("compares versions the way the floor intends (positive control)", () => {
    // Proves the check above is not a tautology that passes on any string.
    expect(meetsFloor("57.0.19", MINIMUM_VERSION)).toBe(true)
    expect(meetsFloor("57.0.17", MINIMUM_VERSION)).toBe(true)
    expect(meetsFloor("57.0.16", MINIMUM_VERSION)).toBe(false)
    expect(meetsFloor("57.0.9", MINIMUM_VERSION)).toBe(false)
    expect(meetsFloor("58.0.0", MINIMUM_VERSION)).toBe(true)
    expect(meetsFloor("56.9.99", MINIMUM_VERSION)).toBe(false)
    expect(meetsFloor("not-a-version", MINIMUM_VERSION)).toBe(false)
  })

  it("upstream premise: the async last-response pair is still the deprecated one", () => {
    // The whole reason the adapter binds the SYNC spellings. If a future SDK
    // flips the deprecation, or removes the sync pair, this goes red before the
    // adapter silently binds the half on its way out.
    const declarations = readInstalled("build/NotificationsEmitter.d.ts")

    for (const call of DEPRECATED_CALLS) {
      expect(docBlockFor(declarations, call)).toContain("@deprecated")
    }
    // And the spellings the adapter binds carry no deprecation of their own.
    for (const call of [
      "getLastNotificationResponse",
      "clearLastNotificationResponse",
    ]) {
      const block = docBlockFor(declarations, call)
      expect(block).not.toBeNull()
      expect(block).not.toContain("@deprecated")
    }
  })

  it("binds the per-identifier dismiss and never the whole-tray one (AE21)", () => {
    const source = readAdapterSource()
    const notifications = require(SPECIFIER)

    // The forbidden call really exists, so its absence is a CHOICE rather than
    // an artefact of the module not having it.
    for (const call of FORBIDDEN_CALLS) {
      expect(typeof notifications[call]).toBe("function")
      expect(source).not.toContain(call)
    }
    expect(source).toContain("dismissNotificationAsync(identifier)")
  })

  it("the adapter names the specifier and binds neither deprecated spelling", () => {
    const source = readAdapterSource()

    expect(source).toMatch(new RegExp(`from\\s+"${SPECIFIER}"`))
    // The deprecated pair is scheduled for removal. Binding it typechecks and
    // works today, so nothing else in this repo would notice.
    for (const call of DEPRECATED_CALLS) {
      expect(source).not.toContain(call)
    }
    // The trailing paren is what separates the sync call from its own prefix.
    expect(source).toContain("getLastNotificationResponse()")
    expect(source).toContain("clearLastNotificationResponse()")
  })

  it("imports exactly the packages the ports need", () => {
    // KTD9 admits `expo-constants` for the project id the token read needs. A
    // third package would widen the app's one native-notification seam, and no
    // behavioural suite would see it.
    expect(packageImports(readAdapterSource()).sort()).toEqual(
      [...ALLOWED_PACKAGES].sort(),
    )
  })

  it("reads package imports the way that rule intends (positive control)", () => {
    expect(
      packageImports(
        [
          'import * as Notifications from "expo-notifications"',
          'import Constants from "expo-constants"',
          'import { x } from "./constants"',
          'const y = require("expo-device")',
        ].join("\n"),
      ),
    ).toEqual(["expo-notifications", "expo-constants", "expo-device"])
    expect(packageImports("export const A = 1")).toEqual([])
  })

  it("separates the sync call from its async prefix (negative control)", () => {
    // Proves the rule above is not satisfied by any string containing the sync
    // name — the deprecated spelling contains it too.
    const broken = "Notifications.getLastNotificationResponseAsync()"

    expect(broken).toContain("getLastNotificationResponse")
    expect(broken).not.toContain("getLastNotificationResponse()")
    expect(broken).toContain(DEPRECATED_CALLS[0])
    // And a mention in prose satisfies nothing.
    expect(stripComments(`// import * as N from "${SPECIFIER}"`)).not.toContain(
      SPECIFIER,
    )
  })

  it("reads a doc block the way the premise intends (positive control)", () => {
    // Proves the reader pairs each block with its OWN declaration — the check
    // above is worthless if it can pick up the neighbour's marker.
    const source = [
      "/**",
      " * Old.",
      " * @deprecated Use next instead.",
      " * @return nothing",
      " */",
      "export declare function old(): void;",
      "/**",
      " * New.",
      " */",
      "export declare function next(): void;",
      "export declare function undocumented(): void;",
    ].join("\n")

    expect(docBlockFor(source, "old")).toContain("@deprecated")
    expect(docBlockFor(source, "next")).not.toContain("@deprecated")
    expect(docBlockFor(source, "undocumented")).toBeNull()
    expect(docBlockFor(source, "absent")).toBeNull()
  })
})
