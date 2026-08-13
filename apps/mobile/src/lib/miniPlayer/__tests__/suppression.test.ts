import { SHEET_SCREENS, createSheetCounter, isSheetRoute } from "../suppression"

describe("isSheetRoute", () => {
  it.each(["watch", "series"] as const)(
    "matches all three %s group sheets",
    (group) => {
      for (const screen of SHEET_SCREENS) {
        expect(isSheetRoute([group, screen])).toBe(true)
      }
    },
  )

  it("counts six sheet routes in total", () => {
    // The plan's R11 scope. If a seventh sheet is added to either layout and
    // not here, it silently stops suppressing the window.
    const matches = (["watch", "series"] as const).flatMap((group) =>
      SHEET_SCREENS.filter((screen) => isSheetRoute([group, screen])),
    )
    expect(matches).toHaveLength(6)
  })

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
