import {
  admitRunSearch,
  releasesSkipFlag,
  shouldRefireLiveQuery,
} from "./searchQueue"

describe("admitRunSearch", () => {
  it("starts on a non-empty query with nothing in flight", () => {
    expect(admitRunSearch("  jesus  ", false)).toEqual({
      kind: "start",
      trimmed: "jesus",
    })
  })

  it("reports empty for blank and whitespace-only queries", () => {
    expect(admitRunSearch("", false)).toEqual({ kind: "empty" })
    expect(admitRunSearch("   ", false)).toEqual({ kind: "empty" })
  })

  it("bails while a request is in flight", () => {
    expect(admitRunSearch("bible", true)).toEqual({ kind: "in-flight" })
  })

  it("checks in-flight BEFORE emptiness", () => {
    expect(admitRunSearch("", true)).toEqual({ kind: "in-flight" })
  })
})

describe("releasesSkipFlag", () => {
  // The regression this encodes: releasing on in-flight let the debounce effect
  // schedule a SECOND request for a term the settle path already chases, so one
  // chip press fired twice.
  it("does NOT release on an in-flight bail", () => {
    expect(releasesSkipFlag(admitRunSearch("x", true))).toBe(false)
  })

  it("releases on empty, so a cleared box leaves nothing armed", () => {
    expect(releasesSkipFlag(admitRunSearch("", false))).toBe(true)
  })

  it("does NOT release when the search actually starts", () => {
    expect(releasesSkipFlag(admitRunSearch("jesus", false))).toBe(false)
  })
})

describe("shouldRefireLiveQuery", () => {
  it("chases the live query when it moved past what just ran", () => {
    expect(shouldRefireLiveQuery("bible", "jesus", false)).toBe(true)
  })

  it("does not re-fire when the live query is what just ran", () => {
    expect(shouldRefireLiveQuery("jesus", "jesus", false)).toBe(false)
    expect(shouldRefireLiveQuery("  jesus  ", "jesus", false)).toBe(false)
  })

  it("yields to a still-scheduled debounce rather than duplicating it", () => {
    expect(shouldRefireLiveQuery("bible", "jesus", true)).toBe(false)
  })

  it("does not re-fire an emptied query box", () => {
    expect(shouldRefireLiveQuery("", "jesus", false)).toBe(false)
    expect(shouldRefireLiveQuery("   ", "jesus", false)).toBe(false)
  })

  // Abandonment: the old captured-query design would replay "bible" here even
  // though the user had moved on to "moses".
  it("follows the user to the newest term, never a stale captured one", () => {
    expect(shouldRefireLiveQuery("moses", "jesus", false)).toBe(true)
  })
})
