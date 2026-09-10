// Plain JS (like the guard suites beside it): the RN tsconfig has no Node
// types, and this guard needs fs/path to read the layout source.
/* eslint-disable @typescript-eslint/no-require-imports */
/* global describe, expect, it, require */
const fs = require("fs")
const path = require("path")

// KTD1: the splash host is a SIBLING of ExperienceShell. The shell swaps its
// element type once per cold launch, when the slug resolves, and remounts its
// whole subtree — a host inside it would restart the animation mid-hold.

// KTD2: preventAutoHideAsync must run at module scope. Expo documents that a
// later call fires after the native splash has already auto-hidden. It belongs
// INSIDE the guarded require block so a throwing splash import still lands on
// the Startup Error panel instead of crashing the module graph.

// R5: both diagnostic panels must be reachable with the native splash gone. A
// held splash covers the only surface the app has for reporting a boot failure.

const LAYOUT = path.join(__dirname, "..", "_layout.tsx")
const NATIVE_SPLASH = path.join(
  __dirname,
  "..",
  "..",
  "src",
  "lib",
  "splash",
  "nativeSplash.ts",
)

function read(file) {
  const content = fs.readFileSync(file, "utf8")
  // A broken path resolution must not vacuously pass every assertion below.
  expect(content.length).toBeGreaterThan(500)
  return content
}

/** Where each root-layout element sits, as source offsets. */
function placement(content) {
  return {
    shellOpen: content.indexOf("<ExperienceShell>"),
    shellClose: content.indexOf("</ExperienceShell>"),
    stack: content.indexOf("<Stack"),
    coveredOpen: content.indexOf("<SplashCoveredTree>"),
    coveredClose: content.indexOf("</SplashCoveredTree>"),
    playbackHost: content.indexOf("<PlaybackHost"),
    splashHost: content.indexOf("<SplashHost"),
  }
}

/** The body of the module-scope guarded require block (KTD2). */
function guardedRequireBlock(content) {
  const start = content.indexOf("try {")
  const end = content.indexOf("} catch (e: unknown) {")
  expect(start).toBeGreaterThan(-1)
  expect(end).toBeGreaterThan(start)
  return content.slice(start, end)
}

/** The body of a `name(...) {` declaration, brace-matched from its header. */
function blockAfter(content, header) {
  const start = content.indexOf(header)
  if (start === -1) return null
  let depth = 0
  for (let i = content.indexOf("{", start); i < content.length; i++) {
    if (content[i] === "{") depth++
    else if (content[i] === "}") {
      depth--
      if (depth === 0) return content.slice(start, i + 1)
    }
  }
  return null
}

/**
 * A panel branch is safe only when the hide call comes BEFORE the JSX. Pure, so
 * a positive-control fixture can prove the detector flags a real omission.
 */
function hidesBeforeReturning(block) {
  if (block == null) return false
  const hide = block.indexOf("hideNativeSplash()")
  const jsx = block.indexOf("return (")
  return hide > -1 && jsx > -1 && hide < jsx
}

describe("splash host ownership", () => {
  it("flags a branch that returns its panel without hiding (positive control)", () => {
    expect(
      hidesBeforeReturning(`if (moduleError) {
        return (
          <View><Text>Startup Error</Text></View>
        )
      }`),
    ).toBe(false)
    expect(
      hidesBeforeReturning(`if (moduleError) {
        hideNativeSplash()
        return (
          <View><Text>Startup Error</Text></View>
        )
      }`),
    ).toBe(true)
  })

  it("keeps the host outside ExperienceShell and above the player", () => {
    const at = placement(read(LAYOUT))
    for (const [name, index] of Object.entries(at)) {
      expect(`${name}=${index}`).not.toContain("=-1")
    }
    // Inside the shell the host would remount when the slug resolves (KTD1).
    expect(at.splashHost).toBeGreaterThan(at.shellClose)
    expect(at.playbackHost).toBeGreaterThan(at.shellClose)
    // The Stack stays INSIDE the shell, so the host is never its ancestor.
    expect(at.stack).toBeGreaterThan(at.shellOpen)
    expect(at.stack).toBeLessThan(at.shellClose)
    // Last child of the same parent, so the cover paints above the player.
    expect(at.splashHost).toBeGreaterThan(at.playbackHost)
  })

  it("keeps everything the cover hides inside the isolated subtree", () => {
    const at = placement(read(LAYOUT))
    expect(at.coveredOpen).toBeGreaterThan(-1)
    expect(at.coveredClose).toBeGreaterThan(at.coveredOpen)
    // R16: Android has no accessibility modal, so only this wrapper keeps the
    // covered tree out of the accessibility tree. Both the shell and the
    // player must be INSIDE it — "after it in the file" holds either way.
    expect(at.shellOpen).toBeGreaterThan(at.coveredOpen)
    expect(at.shellClose).toBeLessThan(at.coveredClose)
    expect(at.playbackHost).toBeGreaterThan(at.coveredOpen)
    expect(at.playbackHost).toBeLessThan(at.coveredClose)
    // And the cover itself must sit OUTSIDE it, or it would hide itself.
    expect(at.splashHost).toBeGreaterThan(at.coveredClose)
  })

  it("holds the native splash from module scope, inside the guarded require", () => {
    const block = guardedRequireBlock(read(LAYOUT))
    expect(block).toContain("preventNativeSplashAutoHide()")
  })

  it("pins what the hold and the release actually call", () => {
    // Falsification: empty either wrapper and every layout assertion above
    // still passes while the native splash auto-hides on its own.
    const source = read(NATIVE_SPLASH)
    expect(source).toMatch(/preventAutoHideAsync\(\)/)
    expect(source).toMatch(/hideAsync\(\)/)
  })

  it("hides the native splash before either error panel renders", () => {
    const content = read(LAYOUT)
    // The App Error path: getDerivedStateFromError runs BEFORE the error render.
    const derived = blockAfter(content, "static getDerivedStateFromError(")
    expect(derived).not.toBeNull()
    expect(derived).toContain("hideNativeSplash()")
    // The Startup Error path is a plain branch, so order inside it is what counts.
    expect(
      hidesBeforeReturning(blockAfter(content, "if (moduleError) {")),
    ).toBe(true)
  })

  it("releases the splash session on BOTH diagnostic paths", () => {
    const content = read(LAYOUT)
    // R5 has two halves: the native splash AND the React cover. Asserting one
    // panel is what let the two branches drift apart in the first place.
    for (const header of [
      "static getDerivedStateFromError(",
      "if (moduleError) {",
    ]) {
      const block = blockAfter(content, header)
      expect(block).not.toBeNull()
      expect(block).toContain("hideNativeSplash()")
      expect(block).toContain("releaseSplashImmediately()")
    }
  })
})
