import {
  IN_APP_SHEET_ROUTE_PATTERNS,
  createNonRouteSheetCounter,
  isInAppSheetRoute,
  isSuppressedBySheet,
  routePattern,
} from "../suppression"

describe("routePattern", () => {
  it("joins segments and keeps group + dynamic segment names verbatim", () => {
    expect(routePattern(["(tabs)", "watch"])).toBe("(tabs)/watch")
    expect(routePattern(["watch", "[slug]"])).toBe("watch/[slug]")
  })

  it("drops empty segments", () => {
    expect(routePattern(["watch", "", "language"])).toBe("watch/language")
  })
})

describe("isInAppSheetRoute", () => {
  it.each(IN_APP_SHEET_ROUTE_PATTERNS)("treats %s as a sheet", (pattern) => {
    expect(isInAppSheetRoute(pattern.split("/"))).toBe(true)
  })

  it("covers exactly the six group sheets", () => {
    expect(IN_APP_SHEET_ROUTE_PATTERNS).toHaveLength(6)
  })

  it.each([
    [["watch", "[slug]"]],
    [["series", "[slug]"]],
    [["(tabs)", "watch"]],
    [["(tabs)", "library"]],
    [["experience", "[slug]"]],
  ])("does not treat %s as a sheet", (segments) => {
    expect(isInAppSheetRoute(segments)).toBe(false)
  })

  it("matches the route pattern, not a slug that reads like one", () => {
    // A video slugged literally "language" resolves as watch/[slug].
    expect(isInAppSheetRoute(["watch", "[slug]"])).toBe(false)
  })
})

describe("non-route sheet counter", () => {
  it("suppresses while either named sheet is open and restores at zero", () => {
    const counter = createNonRouteSheetCounter()
    expect(counter.isPresented()).toBe(false)

    counter.open("libraryDeleteConfirm")
    expect(counter.count()).toBe(1)
    expect(isSuppressedBySheet(["(tabs)", "library"], counter.count())).toBe(
      true,
    )

    counter.close("libraryDeleteConfirm")
    expect(counter.count()).toBe(0)
    expect(isSuppressedBySheet(["(tabs)", "library"], counter.count())).toBe(
      false,
    )

    counter.open("sduiQuiz")
    expect(isSuppressedBySheet(["experience", "[slug]"], counter.count())).toBe(
      true,
    )
    counter.close("sduiQuiz")
    expect(isSuppressedBySheet(["experience", "[slug]"], counter.count())).toBe(
      false,
    )
  })

  it("stays suppressed until BOTH sheets close", () => {
    const counter = createNonRouteSheetCounter()
    counter.open("libraryDeleteConfirm")
    counter.open("sduiQuiz")
    expect(counter.count()).toBe(2)
    counter.close("libraryDeleteConfirm")
    expect(counter.isPresented()).toBe(true)
    counter.close("sduiQuiz")
    expect(counter.isPresented()).toBe(false)
  })

  it("cannot be stranded hidden by a double open or a stray close", () => {
    const counter = createNonRouteSheetCounter()
    counter.open("sduiQuiz")
    counter.open("sduiQuiz")
    counter.close("sduiQuiz")
    expect(counter.count()).toBe(0)

    counter.close("libraryDeleteConfirm")
    expect(counter.count()).toBe(0)
    counter.open("libraryDeleteConfirm")
    expect(counter.count()).toBe(1)
  })

  it("notifies subscribers on a real change only", () => {
    const counter = createNonRouteSheetCounter()
    const listener = jest.fn()
    const unsubscribe = counter.subscribe(listener)

    counter.open("sduiQuiz")
    counter.open("sduiQuiz")
    expect(listener).toHaveBeenCalledTimes(1)

    counter.close("sduiQuiz")
    expect(listener).toHaveBeenCalledTimes(2)

    unsubscribe()
    counter.open("sduiQuiz")
    expect(listener).toHaveBeenCalledTimes(2)
  })
})

describe("isSuppressedBySheet", () => {
  it("is true for a sheet route with no non-route sheet open", () => {
    expect(isSuppressedBySheet(["series", "language"], 0)).toBe(true)
  })

  it("is false on an ordinary route with nothing open", () => {
    expect(isSuppressedBySheet(["(tabs)"], 0)).toBe(false)
  })
})
