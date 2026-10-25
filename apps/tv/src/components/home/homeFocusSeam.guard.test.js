// Plain JS: the RN tsconfig has no Node types, and these guards need fs/path to
// scan source files (same reason as watchSearch.guard.test.js).
/* eslint-disable @typescript-eslint/no-require-imports */
/* global describe, expect, it, require */
const fs = require("fs")
const path = require("path")

// The Home screen's focus handlers are inline useCallbacks in a .tsx screen and
// this app has no component-render test infrastructure, so the seam is only
// reachable by scanning source. The enumeration below IS the contract.
const SOURCE = fs.readFileSync(
  path.resolve(__dirname, "../../../app/index.tsx"),
  "utf8",
)

/** Body of `const <name> = useCallback(` up to its closing `}, [` deps array. */
function handlerBody(name) {
  const start = SOURCE.indexOf(`const ${name} = useCallback(`)
  expect(start).toBeGreaterThan(-1)
  const end = SOURCE.indexOf("}, [", start)
  expect(end).toBeGreaterThan(start)
  return SOURCE.slice(start, end)
}

// Every handler that moves focus OUT of the rails. focusedRowRef is a positional
// index; left set after focus goes elsewhere, recordRowY's "reanchor" branch
// scrolls to a row nobody is on.
const RAIL_EXIT_HANDLERS = [
  "handleChromeFocus",
  "handleMissionFocus",
  "handleHeroFocusChange",
]

describe("Home focus seam", () => {
  // REGRESSION: handleHeroFocusChange shipped without the reset its two siblings
  // had, so rail -> hero left the ref on the rail and a later re-measure scrolled
  // the hero off-screen.
  it.each(RAIL_EXIT_HANDLERS)("%s clears focusedRowRef", (name) => {
    expect(handlerBody(name)).toContain("focusedRowRef.current = null")
  })

  // Anti-vacuous: prove the enumeration is not silently empty and the scan
  // really resolves distinct bodies rather than matching the whole file.
  it("resolves a distinct, bounded body per handler", () => {
    expect(RAIL_EXIT_HANDLERS.length).toBe(3)
    const bodies = RAIL_EXIT_HANDLERS.map(handlerBody)
    expect(new Set(bodies).size).toBe(3)
    for (const body of bodies) expect(body.length).toBeLessThan(SOURCE.length)
  })

  // The trim effect deliberately does NOT reset focusedRowRef — nulling it there
  // disarms the reanchor path the ref exists to serve. Pin the asymmetry so a
  // later "symmetry cleanup" has to argue with a failing test.
  it("keeps focusedRowRef out of the sections-reshape effect", () => {
    const start = SOURCE.indexOf("trimRowMeasurements(rowYsRef.current")
    expect(start).toBeGreaterThan(-1)
    const effect = SOURCE.slice(start, SOURCE.indexOf("}, [", start))
    expect(effect).toContain("pendingScrollRowRef.current = null")
    expect(effect).toContain("lastFocusedRowRef.current = null")
    expect(effect).not.toContain("focusedRowRef.current = null")
  })

  // recordRowY must read the previous y BEFORE overwriting the store, or the
  // "did this row move?" comparison always sees no change and never re-anchors.
  it("reads previousY before writing the new measurement", () => {
    const read = SOURCE.indexOf("previousY: rowYsRef.current[rowIndex]")
    const write = SOURCE.indexOf("rowYsRef.current[rowIndex] = y")
    expect(read).toBeGreaterThan(-1)
    expect(write).toBeGreaterThan(read)
  })
})

// First-mount focus ownership (2026-08-18): the app opens with the top bar's
// Search tab focused. hasTVPreferredFocus is one-shot mount-only, so exactly
// ONE node on Home may carry it — two claims race and the loser is silent.
const TOP_BAR_SOURCE = fs.readFileSync(
  path.resolve(__dirname, "HomeTopBar.tsx"),
  "utf8",
)
const HERO_SOURCE = fs.readFileSync(
  path.resolve(__dirname, "HomeHeroCarousel.tsx"),
  "utf8",
)

/** The one TopBarTab JSX block with this testID, up to its closing `/>`. */
function tabBlock(testID) {
  const start = TOP_BAR_SOURCE.indexOf(`testID="${testID}"`)
  expect(start).toBeGreaterThan(-1)
  return TOP_BAR_SOURCE.slice(start, TOP_BAR_SOURCE.indexOf("/>", start))
}

// Matches the prop as a JSX attribute on its own line; deliberately does NOT
// match prose mentions inside // comments (those lines start with non-space
// tokens before the word).
const PREFERRED_FOCUS_PROP = /^\s*hasTVPreferredFocus\b/m

describe("Home initial focus ownership", () => {
  it("the Search tab claims first-mount focus", () => {
    expect(tabBlock("home-topbar-search-tab")).toContain("hasTVPreferredFocus")
  })

  it.each([
    "home-topbar-home-tab",
    "home-topbar-profile-tab",
    "home-topbar-settings-tab",
  ])("%s does not claim it", (testID) => {
    expect(tabBlock(testID)).not.toContain("hasTVPreferredFocus")
  })

  it("neither the hero carousel nor the screen claims it", () => {
    expect(HERO_SOURCE).not.toMatch(PREFERRED_FOCUS_PROP)
    expect(SOURCE).not.toMatch(PREFERRED_FOCUS_PROP)
  })

  // Anti-vacuous: the prop-shape regex must be able to match at all — the
  // TopBarTab claim itself is written in exactly that shape.
  it("the prop-shape regex is live", () => {
    expect(TOP_BAR_SOURCE).toMatch(PREFERRED_FOCUS_PROP)
  })
})
