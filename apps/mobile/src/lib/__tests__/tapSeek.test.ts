import {
  seekSideForTap,
  seekDeltaForTap,
  classifyTap,
  singleTapAction,
  DOUBLE_TAP_MS,
} from "../tapSeek"

describe("seekSideForTap", () => {
  it("routes the left half to 'left'", () => {
    expect(seekSideForTap(50, 400)).toBe("left")
  })
  it("routes the right half to 'right' (boundary leans right)", () => {
    expect(seekSideForTap(200, 400)).toBe("right")
    expect(seekSideForTap(399, 400)).toBe("right")
  })
  it("is null before the width is known", () => {
    expect(seekSideForTap(50, 0)).toBeNull()
  })
})

describe("seekDeltaForTap", () => {
  it("left half rewinds, right half fast-forwards", () => {
    expect(seekDeltaForTap(50, 400, 10)).toBe(-10)
    expect(seekDeltaForTap(300, 400, 10)).toBe(10)
  })
  it("is a no-op (0) before the width is known", () => {
    expect(seekDeltaForTap(50, 0, 10)).toBe(0)
  })
})

describe("DOUBLE_TAP_MS", () => {
  it("is at least the platform double-tap threshold (~300ms)", () => {
    expect(DOUBLE_TAP_MS).toBeGreaterThanOrEqual(300)
  })
})

describe("classifyTap", () => {
  it("is a double-tap when a single-tap is already pending", () => {
    expect(classifyTap(true)).toBe("double")
  })
  it("starts a single-tap when none is pending", () => {
    expect(classifyTap(false)).toBe("single")
  })
})

describe("singleTapAction", () => {
  it("hides when the chrome was already visible at press-in", () => {
    expect(singleTapAction(true)).toBe("hide")
  })
  it("keeps the chrome up when it was hidden (just revealed on press-in)", () => {
    // Guards R3: a tap-to-reveal must not be undone by its own single-tap timer.
    expect(singleTapAction(false)).toBe("keep")
  })
})
