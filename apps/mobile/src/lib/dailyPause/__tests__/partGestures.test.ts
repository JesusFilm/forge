import {
  PART_FAST_HOLD_MS,
  PART_FAST_RATE,
  PART_FAST_SIDE_SHARE,
  onFastSide,
  partClockLabel,
} from "../partGestures"

const WIDTH = 402

describe("the fast-play sides", () => {
  // The owner, 2026-10-14: as on Instagram, a hold on either side plays at 2x.
  it("plays at 2x after a short hold", () => {
    expect(PART_FAST_RATE).toBe(2)
    expect(PART_FAST_HOLD_MS).toBeLessThan(500)
  })

  it("speeds up a hold on the left or the right side, and not in the middle", () => {
    const side = WIDTH * PART_FAST_SIDE_SHARE
    expect(onFastSide(0, WIDTH)).toBe(true)
    expect(onFastSide(side, WIDTH)).toBe(true)
    expect(onFastSide(side + 1, WIDTH)).toBe(false)
    expect(onFastSide(WIDTH / 2, WIDTH)).toBe(false)
    expect(onFastSide(WIDTH - side - 1, WIDTH)).toBe(false)
    expect(onFastSide(WIDTH - side, WIDTH)).toBe(true)
    expect(onFastSide(WIDTH, WIDTH)).toBe(true)
  })

  it("keeps the middle free for the paused cue", () => {
    // The cue is 88 points wide at the centre of the window.
    expect(WIDTH * (1 - 2 * PART_FAST_SIDE_SHARE)).toBeGreaterThan(88)
  })

  it("speeds up nothing before the window has a width", () => {
    expect(onFastSide(10, 0)).toBe(false)
    expect(onFastSide(Number.NaN, WIDTH)).toBe(false)
  })
})

describe("the scrub pill's clock", () => {
  it("reads minutes and seconds", () => {
    expect(partClockLabel(0)).toBe("0:00")
    expect(partClockLabel(9.9)).toBe("0:09")
    expect(partClockLabel(46.2)).toBe("0:46")
    expect(partClockLabel(125)).toBe("2:05")
    expect(partClockLabel(-3)).toBe("0:00")
    expect(partClockLabel(Number.NaN)).toBe("0:00")
  })
})
