// Node globals are declared locally rather than via @types/node — KTD11 forbids
// new test deps. Same pattern as videoPlayerAutostart.test.ts.
declare const __dirname: string
declare const require: (moduleName: string) => {
  readFileSync: (path: string, encoding: string) => string
  join: (...parts: string[]) => string
}

import { SHEET_SCREENS, createSheetCounter, isSheetRoute } from "../suppression"

const fs = require("node:fs")
const path = require("node:path")

/** The group's detail route, which is a screen but never a sheet. */
const DETAIL_SCREEN = "[slug]"

/**
 * Every `<Stack.Screen name="…">` a route layout declares, minus the detail
 * route.
 *
 * Read from the layout file rather than from the constant under test: an
 * expectation derived from `SHEET_SCREENS` goes red when someone updates the
 * list CORRECTLY and stays green when they forget, which inverts the guard.
 */
function declaredSheetScreens(group: string): string[] {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "..", "..", "..", "app", group, "_layout.tsx"),
    "utf8",
  )
  const declared = (source.match(/<Stack\.Screen\b[\s\S]*?\/>/g) ?? []).map(
    (element: string) => (element.match(/name="([^"]+)"/) ?? [])[1],
  )
  // Without the detail route present, the exclusion below would be silently
  // matching nothing and the derivation would be reading the wrong file shape.
  expect(declared).toContain(DETAIL_SCREEN)
  return declared.filter((name: string) => name !== DETAIL_SCREEN).sort()
}

describe("SHEET_SCREENS drift", () => {
  it("lists exactly the sheets both route layouts declare", () => {
    // The list is what makes suppression work. A sheet added to either layout
    // and not here silently stops hiding the window behind it.
    expect([...SHEET_SCREENS].sort()).toEqual(declaredSheetScreens("watch"))
  })

  it("holds the two layouts to the same set", () => {
    // One list serves both groups, so a sheet added to only one of them is
    // drift too — the constant cannot describe both.
    expect(declaredSheetScreens("series")).toEqual(
      declaredSheetScreens("watch"),
    )
  })
})

describe("isSheetRoute", () => {
  it.each(["watch", "series"] as const)(
    "matches all three %s group sheets",
    (group) => {
      for (const screen of SHEET_SCREENS) {
        expect(isSheetRoute([group, screen])).toBe(true)
      }
    },
  )

  it.each(["watch", "series"] as const)(
    "matches every sheet route %s declares",
    (group) => {
      // Counted against the layout, not against a literal: a hard-coded total
      // goes red on a sheet added correctly to all three files.
      const declared = declaredSheetScreens(group)
      expect(
        declared.filter((screen) => isSheetRoute([group, screen])),
      ).toEqual(declared)
    },
  )

  it("does not match the detail route of either group", () => {
    expect(isSheetRoute(["watch", "[slug]"])).toBe(false)
    expect(isSheetRoute(["series", "[slug]"])).toBe(false)
  })

  it("does not match a same-named screen in another group", () => {
    // The discriminating case for the group prefix: a bare screen-name match
    // would fire on any route that happened to be called "download".
    expect(isSheetRoute(["(tabs)", "library"])).toBe(false)
    expect(isSheetRoute(["experience", "download"])).toBe(false)
    expect(isSheetRoute(["download"])).toBe(false)
  })

  it("tolerates an empty segment list", () => {
    expect(isSheetRoute([])).toBe(false)
  })
})

describe("createSheetCounter", () => {
  it("suppresses while a non-route sheet is open and restores on close", () => {
    const counter = createSheetCounter()
    expect(counter.getCount()).toBe(0)

    counter.openSheet()
    expect(counter.getCount()).toBe(1)

    counter.closeSheet()
    expect(counter.getCount()).toBe(0)
  })

  it("keeps suppressing until the LAST overlapping sheet closes", () => {
    // Why a counter and not a boolean: the first close would otherwise reveal
    // the window under the sheet still on screen.
    const counter = createSheetCounter()
    counter.openSheet()
    counter.openSheet()

    counter.closeSheet()
    expect(counter.getCount()).toBe(1)

    counter.closeSheet()
    expect(counter.getCount()).toBe(0)
  })

  it("floors at zero so an unbalanced close cannot wedge the window hidden", () => {
    const counter = createSheetCounter()
    counter.closeSheet()
    expect(counter.getCount()).toBe(0)

    counter.openSheet()
    expect(counter.getCount()).toBe(1)
  })

  it("notifies subscribers on a real change only", () => {
    const counter = createSheetCounter()
    const listener = jest.fn()
    counter.subscribe(listener)

    counter.closeSheet() // already zero — no change
    expect(listener).not.toHaveBeenCalled()

    counter.openSheet()
    counter.closeSheet()
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it("resets a stranded count", () => {
    const counter = createSheetCounter()
    const listener = jest.fn()
    counter.openSheet()
    counter.openSheet()
    counter.subscribe(listener)

    counter.reset()

    expect(counter.getCount()).toBe(0)
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it("does not notify on a reset that changes nothing", () => {
    const counter = createSheetCounter()
    const listener = jest.fn()
    counter.subscribe(listener)
    counter.reset()
    expect(listener).not.toHaveBeenCalled()
  })

  it("stops notifying after unsubscribe", () => {
    const counter = createSheetCounter()
    const listener = jest.fn()
    counter.subscribe(listener)()
    counter.openSheet()
    expect(listener).not.toHaveBeenCalled()
  })
})
