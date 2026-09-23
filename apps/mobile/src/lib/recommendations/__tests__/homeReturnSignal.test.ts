/**
 * feat-517 KTD5: return-from-watch is a route-segment transition, not a focus
 * event. The Discover tab is also named `watch`, so the cases below pin that
 * the rule reads the `(tabs)` GROUP marker and never the segment name.
 */
import {
  isReturnToHomeFromWatch,
  routeSegmentsFromKey,
} from "../homeReturnSignal"

const HOME_BARE = ["(tabs)"]
const HOME_INDEX = ["(tabs)", "index"]

describe("a return from a watch route (AE7)", () => {
  it.each([
    ["the bare Home segments", HOME_BARE],
    ["Home with its trailing index segment", HOME_INDEX],
  ])("returns true for a watch route into %s", (_name, next) => {
    expect(isReturnToHomeFromWatch(["watch", "[slug]"], next)).toBe(true)
  })

  it.each([
    ["the bare Home segments", HOME_BARE],
    ["Home with its trailing index segment", HOME_INDEX],
  ])("returns true for a series route into %s", (_name, next) => {
    expect(isReturnToHomeFromWatch(["series", "[slug]"], next)).toBe(true)
  })

  it("returns true for a watch route reached without a slug", () => {
    expect(isReturnToHomeFromWatch(["watch"], HOME_BARE)).toBe(true)
  })

  it("returns true for a pop back onto the Discover tab", () => {
    // The controller holds this one until Home focuses (KTD3), so the rule
    // stays a plain "left a watch route, landed in the tab group" test.
    expect(
      isReturnToHomeFromWatch(["watch", "[slug]"], ["(tabs)", "watch"]),
    ).toBe(true)
  })
})

describe("the Discover tab, which is also named watch", () => {
  it.each([
    ["the bare Home segments", HOME_BARE],
    ["Home with its trailing index segment", HOME_INDEX],
  ])("returns false for the Discover tab into %s", (_name, next) => {
    expect(isReturnToHomeFromWatch(["(tabs)", "watch"], next)).toBe(false)
  })

  it("returns false for any other tab", () => {
    expect(isReturnToHomeFromWatch(["(tabs)", "library"], HOME_INDEX)).toBe(
      false,
    )
    expect(isReturnToHomeFromWatch(["(tabs)", "profile"], HOME_BARE)).toBe(
      false,
    )
  })

  it("returns false for Home to Home", () => {
    expect(isReturnToHomeFromWatch(HOME_INDEX, HOME_BARE)).toBe(false)
  })

  it("returns false when the group marker sits later in the previous route", () => {
    // SYNTHETIC: `useSegments` puts the group marker first, so no route the
    // router emits has this shape. It is the only fixture that discriminates
    // the group guard, which the first-segment check would otherwise hide.
    expect(isReturnToHomeFromWatch(["watch", "(tabs)"], HOME_BARE)).toBe(false)
  })
})

describe("the routes that play video but are not watch routes", () => {
  it.each([
    ["an SDUI video route", ["video", "[sectionKey]"]],
    ["an SDUI collection route", ["collection", "[sectionKey]"]],
    ["an Experience route", ["experience", "[slug]"]],
    ["the mission route", ["mission"]],
  ])("returns false for %s", (_name, previous) => {
    expect(isReturnToHomeFromWatch(previous, HOME_BARE)).toBe(false)
  })
})

describe("the transitions that are not a return", () => {
  it("returns false when the viewer opens a watch route", () => {
    expect(isReturnToHomeFromWatch(HOME_INDEX, ["watch", "[slug]"])).toBe(false)
  })

  it("returns false for a watch route into a series route", () => {
    expect(isReturnToHomeFromWatch(["watch", "[slug]"], ["series", "x"])).toBe(
      false,
    )
  })

  it("returns false when the next segments only contain the group later", () => {
    expect(isReturnToHomeFromWatch(["watch", "[slug]"], ["x", "(tabs)"])).toBe(
      false,
    )
  })
})

describe("a route into itself", () => {
  // Home keys its effect on the joined string, so a repeat is normally not
  // delivered — but a re-run must never fire a refresh on its own.
  it.each([
    ["Home", HOME_BARE],
    ["Home with its index segment", HOME_INDEX],
    ["the Discover tab", ["(tabs)", "watch"]],
    ["a watch route", ["watch", "[slug]"]],
    ["a series route", ["series", "[slug]"]],
    ["no route at all", []],
  ])("returns false for %s", (_name, route) => {
    expect(isReturnToHomeFromWatch(route, route)).toBe(false)
  })
})

describe("malformed segments", () => {
  it("returns false for empty previous segments", () => {
    expect(isReturnToHomeFromWatch([], HOME_BARE)).toBe(false)
  })

  it("returns false for empty next segments", () => {
    expect(isReturnToHomeFromWatch(["watch", "[slug]"], [])).toBe(false)
  })

  it("returns false for both empty", () => {
    expect(isReturnToHomeFromWatch([], [])).toBe(false)
  })
})

describe("routeSegmentsFromKey", () => {
  it("round-trips the shapes the effect stores", () => {
    expect(routeSegmentsFromKey("")).toEqual([])
    expect(routeSegmentsFromKey("(tabs)")).toEqual(["(tabs)"])
    expect(routeSegmentsFromKey("(tabs)/index")).toEqual(["(tabs)", "index"])
    expect(routeSegmentsFromKey("watch/[slug]")).toEqual(["watch", "[slug]"])
  })

  it("feeds the discriminator the same answer as the arrays do", () => {
    expect(
      isReturnToHomeFromWatch(
        routeSegmentsFromKey("watch/[slug]"),
        routeSegmentsFromKey("(tabs)"),
      ),
    ).toBe(true)
    expect(
      isReturnToHomeFromWatch(
        routeSegmentsFromKey("(tabs)/watch"),
        routeSegmentsFromKey("(tabs)"),
      ),
    ).toBe(false)
  })
})
