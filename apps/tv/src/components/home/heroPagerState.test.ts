import { advanceByDelta, backFace, shouldSkipSlide } from "./heroPagerState"

describe("advanceByDelta", () => {
  it("advances to the next slide (+1)", () => {
    expect(advanceByDelta(0, 1, 4)).toBe(1)
    expect(advanceByDelta(2, 1, 4)).toBe(3)
  })

  it("wraps the last slide back to the first on +1", () => {
    expect(advanceByDelta(3, 1, 4)).toBe(0)
  })

  it("goes to the previous slide (-1)", () => {
    expect(advanceByDelta(3, -1, 4)).toBe(2)
    expect(advanceByDelta(1, -1, 4)).toBe(0)
  })

  it("wraps the first slide back to the last on -1", () => {
    expect(advanceByDelta(0, -1, 4)).toBe(3)
  })

  it("stays at 0 for an empty or single set in either direction", () => {
    expect(advanceByDelta(0, 1, 0)).toBe(0)
    expect(advanceByDelta(0, -1, 0)).toBe(0)
    expect(advanceByDelta(0, 1, 1)).toBe(0)
    expect(advanceByDelta(0, -1, 1)).toBe(0)
  })
})

describe("backFace", () => {
  it("returns the other cell of the two-cell ring", () => {
    expect(backFace(0)).toBe(1)
    expect(backFace(1)).toBe(0)
  })
})

describe("shouldSkipSlide", () => {
  it("skips when the incoming card already sits on the front face", () => {
    expect(shouldSkipSlide("a", "a")).toBe(true)
  })

  it("does not skip a genuine change", () => {
    expect(shouldSkipSlide("b", "a")).toBe(false)
  })

  it("never skips when nothing is painted yet", () => {
    expect(shouldSkipSlide("a", null)).toBe(false)
    expect(shouldSkipSlide(null, null)).toBe(false)
    expect(shouldSkipSlide(null, "a")).toBe(false)
  })
})
