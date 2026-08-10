// Plain JS: the RN tsconfig has no Node types, and this guard needs fs/path to
// scan source files (same reason as watchSearch.guard.test.js and
// homeFocusSeam.guard.test.js).
/* eslint-disable @typescript-eslint/no-require-imports */
/* global describe, expect, it, require */
const fs = require("fs")
const path = require("path")

// `docs/observability/datadog.md` asserts TV attaches no user identity to
// Datadog. Before feat-322 that held for free — TV had no accounts. It now has
// them (RFC 8628 device grant), so the claim needs a guard, and the claim is
// about the WHOLE app: a `setUser` added in a screen three PRs from now is
// exactly the regression, and no module-scoped test would see it.
const SRC = path.resolve(__dirname, "../..")

/** Every .ts/.tsx file under src/, recursively. */
function sourceFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((item) => {
    const full = path.join(dir, item.name)
    if (item.isDirectory()) return sourceFiles(full)
    return /\.tsx?$/.test(item.name) ? [full] : []
  })
}

// Call-shaped, not name-shaped: prose that NAMES the API (this file, the
// telemetry module header, apps/tv/CLAUDE.md's posture note) is documentation,
// and a guard that flagged it would be deleted the first time it cried wolf.
const CALL = /\bsetUser(Info)?\s*\(/

describe("TV attaches no user identity to Datadog", () => {
  it("never calls the SDK's user-identity API anywhere in src/", () => {
    const offenders = sourceFiles(SRC).filter((file) =>
      CALL.test(fs.readFileSync(file, "utf8")),
    )
    expect(offenders).toEqual([])
  })

  // Anti-vacuous #1: the pattern must actually match a call.
  it("would notice a call if one appeared", () => {
    expect(CALL.test('DdSdkReactNative.setUser({ id: "u1" })')).toBe(true)
    expect(CALL.test("DdSdk.setUserInfo(info)")).toBe(true)
    expect(CALL.test("// TV deliberately never calls setUserInfo")).toBe(false)
  })

  // Anti-vacuous #2: an empty or mis-rooted file list would pass forever.
  it("can actually see the source it is guarding", () => {
    const files = sourceFiles(SRC)
    expect(files.length).toBeGreaterThan(50)
    expect(files).toContain(
      path.join(SRC, "lib", "auth", "deviceGrantTelemetry.ts"),
    )
  })
})
