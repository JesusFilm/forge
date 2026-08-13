import {
  clamp,
  hasUsableDuration,
  applySkip,
  fractionToTime,
  progressFraction,
  thumbOutputRange,
} from "../scrubber"

describe("clamp", () => {
  it("bounds a value to [min, max]", () => {
    expect(clamp(5, 0, 10)).toBe(5)
    expect(clamp(-1, 0, 10)).toBe(0)
    expect(clamp(11, 0, 10)).toBe(10)
  })
})

describe("hasUsableDuration", () => {
  it("is false for 0, NaN, Infinity, negative", () => {
    expect(hasUsableDuration(0)).toBe(false)
    expect(hasUsableDuration(NaN)).toBe(false)
    expect(hasUsableDuration(Infinity)).toBe(false)
    expect(hasUsableDuration(-5)).toBe(false)
  })
  it("is true for a positive finite duration", () => {
    expect(hasUsableDuration(120)).toBe(true)
  })
})

describe("applySkip (AE3: skip clamps at boundaries)", () => {
  it("+10s near the end clamps to duration", () => {
    expect(applySkip(115, 10, 120)).toBe(120)
  })
  it("-10s near the start clamps to 0", () => {
    expect(applySkip(5, -10, 120)).toBe(0)
  })
  it("applies a mid-clip skip exactly", () => {
    expect(applySkip(50, 10, 120)).toBe(60)
    expect(applySkip(50, -10, 120)).toBe(40)
  })
  it("is a no-op (null) while duration is unknown", () => {
    expect(applySkip(0, 10, 0)).toBeNull()
    expect(applySkip(0, 10, NaN)).toBeNull()
  })
})

describe("fractionToTime", () => {
  it("maps 0→0, 1→duration, 0.5→duration/2", () => {
    expect(fractionToTime(0, 120)).toBe(0)
    expect(fractionToTime(1, 120)).toBe(120)
    expect(fractionToTime(0.5, 120)).toBe(60)
  })
  it("clamps an out-of-range fraction", () => {
    expect(fractionToTime(-0.2, 120)).toBe(0)
    expect(fractionToTime(1.5, 120)).toBe(120)
  })
  it("is null while duration is unknown", () => {
    expect(fractionToTime(0.5, 0)).toBeNull()
    expect(fractionToTime(0.5, NaN)).toBeNull()
  })
})

describe("progressFraction", () => {
  it("never exceeds 1 even when currentTime overshoots duration", () => {
    expect(progressFraction(125, 120)).toBe(1)
  })
  it("is 0 while duration is unknown (no NaN)", () => {
    expect(progressFraction(10, 0)).toBe(0)
    expect(progressFraction(10, NaN)).toBe(0)
  })
  it("computes a mid value", () => {
    expect(progressFraction(60, 120)).toBe(0.5)
  })
})

describe("thumbOutputRange", () => {
  it("spans the whole track when not flush", () => {
    expect(thumbOutputRange(300, 14, false)).toEqual([0, 300])
  })

  // A flush bar runs to the screen edges, so an un-inset thumb would render
  // half off-screen at both ends.
  it("insets both ends by the thumb radius when flush", () => {
    expect(thumbOutputRange(300, 14, true)).toEqual([7, 293])
  })

  // The track measures 0 until onLayout; the range must stay ordered rather
  // than inverting, or the interpolation runs backwards on the first frame.
  it("collapses to a point at track width 0", () => {
    expect(thumbOutputRange(0, 14, true)).toEqual([7, 7])
    expect(thumbOutputRange(0, 14, false)).toEqual([0, 0])
  })

  it("never inverts when the track is narrower than the thumb", () => {
    const [start, end] = thumbOutputRange(10, 14, true)
    expect(end).toBeGreaterThanOrEqual(start)
  })
})
