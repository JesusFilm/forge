import {
  presentationFor,
  windowHoldsSurface,
  type MiniPlayerSessionView,
} from "../presentation"

const SESSION: MiniPlayerSessionView = {
  videoId: "video-1",
  videoSlug: "birth-of-jesus",
}

/** Every root-stack destination, taken from app/_layout.tsx's Stack.Screen set. */
const TAB_ROOTS = [
  ["(tabs)", "index"],
  ["(tabs)", "watch"],
  ["(tabs)", "library"],
  ["(tabs)", "profile"],
] as const

const WATCH_SHEETS = ["language", "subtitle", "download"] as const
const SERIES_SHEETS = ["language", "subtitle", "download"] as const

describe("presentationFor", () => {
  it("returns none when there is no session", () => {
    // R19's exclusion is expressed as "no session was ever opened", keyed on
    // where playback ORIGINATED. A video opened from an SDUI experience page
    // never creates one, so every route reads none.
    expect(presentationFor(null, ["(tabs)", "index"])).toBe("none")
    expect(presentationFor(null, ["experience", "[slug]"])).toBe("none")
    expect(presentationFor(null, ["watch", "[slug]"])).toBe("none")
  })

  it.each(TAB_ROOTS)("floats over the %s/%s tab root", (...segments) => {
    expect(presentationFor(SESSION, segments)).toBe("floating")
  })

  it("shows the full view on the watch route", () => {
    expect(presentationFor(SESSION, ["watch", "[slug]"])).toBe("full")
  })

  it.each(WATCH_SHEETS)("stays full behind the watch %s sheet", (sheet) => {
    // R11: suppression never applies to the full-screen view. The player is
    // still on screen behind the sheet — hiding it would blank the video the
    // sheet is about.
    expect(presentationFor(SESSION, ["watch", sheet])).toBe("full")
  })

  it.each(SERIES_SHEETS)("hides behind the series %s sheet", (sheet) => {
    expect(presentationFor(SESSION, ["series", sheet])).toBe("hidden")
  })

  it("floats over the series detail route itself", () => {
    // Only the sheets suppress; the series screen underneath does not.
    expect(presentationFor(SESSION, ["series", "[slug]"])).toBe("floating")
  })

  it.each([
    [["experience", "[slug]"]],
    [["video", "[sectionKey]"]],
    [["collection", "[sectionKey]"]],
    [["mission"]],
  ])("keeps a live session floating on %s (R3)", (segments) => {
    // R3 promises the window survives further route pushes. Exclusion is keyed
    // on ORIGIN, so a session that started on a normal route and was carried
    // onto an excluded one keeps playing.
    expect(presentationFor(SESSION, segments)).toBe("floating")
  })

  it("hides while a non-route sheet is counted open (R11)", () => {
    expect(
      presentationFor(SESSION, ["(tabs)", "library"], { sheetCount: 1 }),
    ).toBe("hidden")
  })

  it("restores the window when the sheet count returns to zero", () => {
    expect(
      presentationFor(SESSION, ["(tabs)", "library"], { sheetCount: 0 }),
    ).toBe("floating")
  })

  it("does not let a counted sheet suppress the full-screen view", () => {
    // The counter is global, so without this the watch route would blank
    // whenever a library sheet was left counted open.
    expect(
      presentationFor(SESSION, ["watch", "[slug]"], { sheetCount: 2 }),
    ).toBe("full")
  })

  it("hides the floating window while OS picture-in-picture is showing (KTD16)", () => {
    expect(
      presentationFor(SESSION, ["(tabs)", "index"], { pipActive: true }),
    ).toBe("hidden")
  })

  it("keeps the full view while OS picture-in-picture is showing", () => {
    // KTD16 forbids both windows at once, but the full view is the surface
    // picture-in-picture was handed FROM — unmounting it mid-handoff is the
    // R24 violation.
    expect(
      presentationFor(SESSION, ["watch", "[slug]"], { pipActive: true }),
    ).toBe("full")
  })

  it("treats an empty segment list as a floating root", () => {
    expect(presentationFor(SESSION, [])).toBe("floating")
  })

  it("does not confuse the watch TAB with the watch route group", () => {
    // The discriminating pair: (tabs)/watch is Discover, watch/[slug] is the
    // player. A name-based table that missed the group prefix would return
    // full for the Discover tab and never show the window there.
    expect(presentationFor(SESSION, ["(tabs)", "watch"])).toBe("floating")
    expect(presentationFor(SESSION, ["watch", "[slug]"])).toBe("full")
  })
})

describe("windowHoldsSurface", () => {
  // The window's render gate and the host's `surfaceFree` publish read this
  // ONE function. A table, so a presentation added later cannot be answered by
  // omission on either side.
  it.each([
    ["floating", true],
    ["hidden", true],
    ["full", false],
    ["none", false],
  ] as const)("answers %s with %s", (presentation, holds) => {
    expect(windowHoldsSurface(presentation)).toBe(holds)
  })

  it("is false for exactly the presentations that mount no view", () => {
    // `full` hands the surface to the watch route and `none` has no session,
    // so those are the two the claimant may borrow into.
    const free = (["full", "floating", "hidden", "none"] as const).filter(
      (presentation) => !windowHoldsSurface(presentation),
    )
    expect(free).toEqual(["full", "none"])
  })
})
