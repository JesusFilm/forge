import { DIP_TIMINGS, dipOpacityRange, dipTiming } from "../stepDip"

/** One display frame, in ms. */
const FRAME_MS = 16

describe("DIP_TIMINGS", () => {
  it("makes a jump quicker than a step of the flow", () => {
    const flow = DIP_TIMINGS.flow
    const jump = DIP_TIMINGS.jump
    expect(jump.totalMs).toBeLessThan(flow.totalMs)
    expect(flow.totalMs).toBe(flow.outMs + flow.holdMs + flow.inMs)
    expect(jump.totalMs).toBe(jump.outMs + jump.holdMs + jump.inMs)
  })

  // The step changes under a fully dark veil, with a frame to spare on each
  // side, so no frame shows the swap.
  it("changes the step inside the dark hold", () => {
    for (const timing of Object.values(DIP_TIMINGS)) {
      expect(timing.swapMs).toBeGreaterThanOrEqual(timing.outMs + FRAME_MS)
      expect(timing.swapMs).toBeLessThanOrEqual(
        timing.outMs + timing.holdMs - FRAME_MS,
      )
    }
  })
})

describe("dipTiming", () => {
  it("uses the quick dip for every change with Reduce Motion on", () => {
    expect(dipTiming("flow", false)).toBe(DIP_TIMINGS.flow)
    expect(dipTiming("jump", false)).toBe(DIP_TIMINGS.jump)
    expect(dipTiming("flow", true)).toBe(DIP_TIMINGS.jump)
    expect(dipTiming("jump", true)).toBe(DIP_TIMINGS.jump)
  })
})

describe("dipOpacityRange", () => {
  for (const [kind, timing] of Object.entries(DIP_TIMINGS)) {
    describe(kind, () => {
      const { inputRange, outputRange } = dipOpacityRange(timing)
      const at = (ms: number) => {
        const t = ms / timing.totalMs
        const i = inputRange.findIndex((x) => x >= t)
        if (inputRange[i] === t) return outputRange[i]!
        const [x0, x1] = [inputRange[i - 1]!, inputRange[i]!]
        const [y0, y1] = [outputRange[i - 1]!, outputRange[i]!]
        return y0 + ((t - x0) / (x1 - x0)) * (y1 - y0)
      }

      it("rises in order from clear to dark and back", () => {
        expect(inputRange[0]).toBe(0)
        expect(inputRange.at(-1)).toBe(1)
        for (let i = 1; i < inputRange.length; i += 1) {
          expect(inputRange[i]!).toBeGreaterThan(inputRange[i - 1]!)
        }
        expect(outputRange[0]).toBe(0)
        expect(outputRange.at(-1)).toBe(0)
      })

      it("is fully dark through the hold, and only there", () => {
        expect(at(timing.outMs)).toBe(1)
        expect(at(timing.swapMs)).toBe(1)
        expect(at(timing.outMs + timing.holdMs)).toBe(1)
        expect(at(timing.outMs / 2)).toBeLessThan(1)
        expect(at(timing.outMs + timing.holdMs + timing.inMs / 2)).toBeLessThan(
          1,
        )
      })

      it("eases in to the dark and eases out of it", () => {
        // Ease-in: the first half of the fade covers less than half the way.
        expect(at(timing.outMs / 2)).toBeLessThan(0.5)
        // Ease-out: the first half of the lift covers more than half the way.
        expect(at(timing.outMs + timing.holdMs + timing.inMs / 2)).toBeLessThan(
          0.5,
        )
      })
    })
  }
})
