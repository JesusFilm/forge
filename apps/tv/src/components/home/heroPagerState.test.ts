import { advanceIndex, backFace, shouldSkipSlide } from "./heroPagerState"

describe("advanceIndex", () => {
  it("advances to the next slide", () => {
    expect(advanceIndex(0, 4)).toBe(1)
    expect(advanceIndex(2, 4)).toBe(3)
  })

  it("wraps the last slide back to the first", () => {
    expect(advanceIndex(3, 4)).toBe(0)
  })

  it("stays at 0 for an empty or single set", () => {
    expect(advanceIndex(0, 0)).toBe(0)
    expect(advanceIndex(0, 1)).toBe(0)
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
