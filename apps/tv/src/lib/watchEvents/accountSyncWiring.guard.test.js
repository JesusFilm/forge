// Plain JS: the RN tsconfig has no Node types, and this guard needs fs/path to
// read a source file (same reason as zeroPii.guard.test.js and
// watchSearch.guard.test.js).
/* eslint-disable @typescript-eslint/no-require-imports */
/* global describe, expect, it, require */
const fs = require("fs")
const path = require("path")

// app/profile.tsx is the composition root for the account merge, and apps/tv
// has no render harness — so every rule it wires lives in a React-free module
// with its own tests, and NOTHING covers the wiring itself. That leaves three
// one-line revert surfaces whose reversion compiles, typechecks, and leaves
// the entire suite green:
//
//   1. `submitProgress: async () => true` — the stub this feature replaced.
//      Restoring it makes the promotion report success while uploading
//      nothing; the shelf is then wiped at sign-out with no server copy, i.e.
//      exactly the data-loss bug this work fixes, silently.
//   2. An unguarded shelf submit on the sign-out path — bypassing
//      `flushOwnedShelfOnSignOut`'s ownership check re-opens the cross-account
//      upload on a shared TV.
//   3. Passing a literal instead of `identity?.userId` — the flush would be
//      authorized against something other than the signed-in account.
//
// Token-shaped assertions on the one file, deliberately: a whole-src scan
// would flag the sync module's own internals, and this is about what the
// composition root is wired to.
const PROFILE_ROUTE = path.resolve(__dirname, "../../../app/profile.tsx")

describe("profile route wires the real account sync", () => {
  const source = fs.readFileSync(PROFILE_ROUTE, "utf8")

  it("passes the real submitter into promoteAnonymousStateToAccount", () => {
    expect(source).toContain("submitContinueWatchingToAccount(")
    expect(source).toMatch(/submitProgress:\s*\(payload\)\s*=>/)
  })

  it("has NOT reverted submitProgress to the always-true stub", () => {
    // The exact literal this feature replaced, in any spacing.
    expect(source).not.toMatch(/submitProgress:\s*async\s*\(\s*\)\s*=>\s*true/)
  })

  it("routes the sign-out flush through the ownership-gated helper", () => {
    expect(source).toContain("flushOwnedShelfOnSignOut(identity?.userId)")
  })

  it("does not submit the shelf on the sign-out path outside that helper", () => {
    const signOutBody = source.slice(source.indexOf("const handleSignOut"))
    expect(signOutBody).not.toContain("submitContinueWatchingToAccount(")
    expect(signOutBody).not.toContain("syncContinueWatchingWithAccount(")
  })

  it("purges the account cache on sign-out", () => {
    expect(source).toContain("purgeAccountProgressCache()")
  })

  // The handoff waits on the merge so Home paints an already-merged shelf.
  // Dropping the awaits reverts to fire-and-forget, and Home would show the
  // PRE-merge shelf until the next visit — invisible to every unit test,
  // since the rules module has no idea whether its caller waited.
  it("AWAITS the account sync/hydrate so the handoff can wait on it", () => {
    expect(source).toContain("await syncContinueWatchingWithAccount()")
    expect(source).toContain("await hydrateContinueWatchingFromAccount()")
    expect(source).not.toContain("void syncContinueWatchingWithAccount()")
    expect(source).not.toContain("void hydrateContinueWatchingFromAccount()")
  })

  it("signals the aftermath settled from a finally, not the happy path", () => {
    // In `finally`, so a thrown identity lookup still hands off rather than
    // stranding a signed-in viewer on the code screen until the cap expires.
    expect(source).toMatch(
      /finally\s*\{[^}]*aftermathSettledRef\.current\?\.\(\)/,
    )
  })

  it("gates the handoff on a FRESH grant, never on being signed in alone", () => {
    expect(source).toContain("shouldHandOffToHome({")
    expect(source).toContain("grantCompleted: grantedAtMs != null")
  })
})

// ── VideoPlayer's playToEnd ordering ────────────────────────────────────────
// The Up Next offer INTERCEPTS the end-of-playback dismissal — but the QoE
// "ended" summary and the Continue Watching completion report must have fired
// BEFORE the interception, or offering (then abandoning) an episode would
// silently drop the completion that feeds the account sync (todo 025). No
// render harness can pin listener internals, so the ordering is pinned as
// source-token order inside the playToEnd listener.
describe("VideoPlayer playToEnd keeps reporting before the Up Next offer", () => {
  const playerSource = fs.readFileSync(
    path.resolve(__dirname, "../../components/VideoPlayer.tsx"),
    "utf8",
  )
  const listenerStart = playerSource.indexOf('addListener("playToEnd"')
  // One listener, generously sliced — the whole callback is well under this.
  const listener = playerSource.slice(listenerStart, listenerStart + 3000)

  it("has exactly one playToEnd listener", () => {
    expect(listenerStart).toBeGreaterThan(-1)
    expect(
      playerSource.indexOf('addListener("playToEnd"', listenerStart + 1),
    ).toBe(-1)
  })

  it("finalizes QoE, then reports completion, then offers Up Next", () => {
    const qoeAt = listener.indexOf('finalize("ended")')
    const completionAt = listener.indexOf("onPlaybackPositionRef.current?.(")
    const offerAt = listener.indexOf("upNextTargetRef.current != null")
    expect(qoeAt).toBeGreaterThan(-1)
    expect(completionAt).toBeGreaterThan(qoeAt)
    expect(offerAt).toBeGreaterThan(completionAt)
  })
})
