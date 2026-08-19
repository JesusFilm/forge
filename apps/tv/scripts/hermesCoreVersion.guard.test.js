// Plain JS: the RN tsconfig has no Node types, and this guard needs fs/path to
// read eas.json and the installed react-native-tvos manifest (same reason as
// zeroPii.guard.test.js and watchSearch.guard.test.js).
/* eslint-disable @typescript-eslint/no-require-imports */
/* global describe, expect, it, require, __dirname */
const fs = require("fs")
const path = require("path")

// Why this pin exists (EAS build 8, 2026-08-19):
//
// `hermes-engine.podspec` resolves its react_native_path with
// `require.resolve("react-native", { paths: [<hermes dir>] })`. Under pnpm that
// call escapes the react-native-tvos package entirely and lands on whatever
// core `react-native` is hoisted into `node_modules/.pnpm/node_modules` — which
// is apps/mobile's. While mobile sat on RN 0.81.5 that produced the right
// answer by coincidence. PR #1926 moved mobile to Expo SDK 57 / RN 0.86.2, so
// the podspec started computing core version 0.86.2, whose hermes-ios tarball
// is not on Maven Central (404). It then fell through to BUILD_FROM_GITHUB_MAIN,
// which needs `cmake` — absent on EAS workers — and every tvOS build died in
// "Install pods".
//
// `REACT_NATIVE_OVERRIDE_NIGHTLY_BUILD_VERSION` is RN-tvOS's own escape hatch
// for this computation (scripts/cocoapods/utils.rb `core_version_for_tv_version`
// is its only consumer), and it only applies when the resolved version carries
// no `-N` suffix — i.e. exactly the mis-resolution case. A correct resolution
// would yield `0.81.5-2`, which has a suffix, so the override goes inert on its
// own if the resolution is ever fixed.
//
// The hazard this guard covers: a react-native-tvos bump leaves the pin stale,
// and a stale pin does NOT fail the build — it silently downloads the WRONG
// Hermes for the new RN. That is worse than the outage it replaced, so assert
// the pin still equals the value the podspec would compute for the version we
// actually install.
const OVERRIDE_KEY = "REACT_NATIVE_OVERRIDE_NIGHTLY_BUILD_VERSION"

/**
 * Byte-for-byte port of `ReactNativePodsUtils.core_version_for_tv_version`
 * (react-native-tvos scripts/cocoapods/utils.rb). Kept here so a bump in the
 * upstream mapping shows up as a failing expectation rather than a silent
 * divergence.
 */
function coreVersionForTvVersion(version) {
  const match = /(.+)-(.+)/.exec(version)
  if (match == null) return version
  const coreBaseVersion = match[1]
  const prereleaseMatch = /0rc(\d+)/.exec(match[2])
  if (prereleaseMatch == null) return coreBaseVersion
  return `${coreBaseVersion}-rc.${prereleaseMatch[1]}`
}

function installedTvosVersion() {
  // Resolve through the app's own alias (`react-native` -> react-native-tvos),
  // which is the package the podspec is SUPPOSED to describe.
  const manifest = require.resolve("react-native/package.json", {
    paths: [path.resolve(__dirname, "..")],
  })
  return JSON.parse(fs.readFileSync(manifest, "utf8")).version
}

describe("hermes core-version pin in eas.json", () => {
  const eas = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, "../eas.json"), "utf8"),
  )
  const profiles = Object.entries(eas.build)

  it("pins the override on every build profile", () => {
    expect(profiles.length).toBeGreaterThan(0)
    for (const [name, profile] of profiles) {
      expect({ name, value: profile.env?.[OVERRIDE_KEY] }).toEqual({
        name,
        value: expect.any(String),
      })
    }
  })

  it("pins the value the podspec would compute for the installed react-native-tvos", () => {
    const expected = coreVersionForTvVersion(installedTvosVersion())
    for (const [name, profile] of profiles) {
      expect({ name, value: profile.env?.[OVERRIDE_KEY] }).toEqual({
        name,
        value: expected,
      })
    }
  })

  it("maps tv versions the way the upstream ruby does", () => {
    // Falsifies the port itself: a suffix that is not `0rcN` drops to the base
    // version (our case), `0rcN` becomes an rc, and a bare version passes through.
    expect(coreVersionForTvVersion("0.81.5-2")).toBe("0.81.5")
    expect(coreVersionForTvVersion("0.79.0-0rc1")).toBe("0.79.0-rc.1")
    expect(coreVersionForTvVersion("0.81.5")).toBe("0.81.5")
  })
})
