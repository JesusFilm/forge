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

// ── The OTHER PII channel ───────────────────────────────────────────────────
//
// `setUser` is one of two documented ways identity reaches Datadog from this
// app. The other is `accessibilityLabel`, which the RUM SDK turns into the tap
// action name (apps/tv/CLAUDE.md, "Action-name privacy"; feat-322's constraint
// "user code/email must never reach an accessibilityLabel that becomes a RUM
// action name"). The guard above is structurally blind to it: the profile
// screen leaked the viewer's real email as a RUM action name for a whole PR
// while every `setUser` assertion stayed green.
//
// apps/tv has no render harness, so this is a source guard like its sibling.
// The rule is shape-based rather than name-based: a `label` bound to an
// EXPRESSION is by definition not a constant, so it may carry viewer data and
// must be paired with a generic `ddActionName`. A `label` bound to a string
// literal ("Sign out") is safe and is deliberately not required to.
const PROFILE_SCREEN = path.resolve(
  __dirname,
  "../../components/profile/ProfileScreen.tsx",
)

/** Each `<ProfileRow …/>` element in the file, as raw source text. */
function profileRows(source) {
  return [...source.matchAll(/<ProfileRow\b[\s\S]*?\/>/g)].map((m) => m[0])
}

describe("profile rows keep viewer data out of RUM action names", () => {
  const source = fs.readFileSync(PROFILE_SCREEN, "utf8")
  const rows = profileRows(source)
  const dynamicLabelRows = rows.filter((row) => /label=\{/.test(row))

  it("gives every dynamically-labelled row a generic ddActionName", () => {
    const unprotected = dynamicLabelRows.filter(
      (row) => !/ddActionName=/.test(row),
    )
    expect(unprotected).toEqual([])
  })

  it("forwards ddActionName to the Pressable as dd-action-name", () => {
    // Without this the prop above would be inert — accepted, ignored, and the
    // accessibilityLabel would still win as the action name.
    expect(source).toMatch(/"dd-action-name": ddActionName/)
  })

  // Anti-vacuous #1: the rows carrying the name and the email must actually be
  // in the set this guard checks, or it is asserting over an empty list.
  it("is actually looking at the name and email rows", () => {
    expect(dynamicLabelRows.length).toBeGreaterThanOrEqual(2)
    expect(
      dynamicLabelRows.some((row) => /testID="profile-name-row"/.test(row)),
    ).toBe(true)
    expect(
      dynamicLabelRows.some((row) => /testID="profile-email-row"/.test(row)),
    ).toBe(true)
  })

  // Anti-vacuous #2: a string-literal label is NOT required to carry an
  // override — if it were, the rule would be about nothing in particular and
  // the first person to hit it would delete the guard.
  it("does not demand an override for a constant label", () => {
    const signOut = rows.find((row) => /label="Sign out"/.test(row))
    expect(signOut).toBeDefined()
    expect(/label=\{/.test(signOut)).toBe(false)
  })
})
