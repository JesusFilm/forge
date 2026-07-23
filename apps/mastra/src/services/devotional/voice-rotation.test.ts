import { describe, expect, it } from "vitest"

import {
  FILTER_ROTATION,
  rotateFilter,
  rotateVoice,
  VOICE_ROTATION,
} from "./voice-rotation"

describe("rotateVoice", () => {
  it("rotates D -> E -> C across consecutive devotionals", () => {
    expect(rotateVoice(0)).toBe("male-d")
    expect(rotateVoice(1)).toBe("male-e")
    expect(rotateVoice(2)).toBe("female-c")
  })

  it("wraps back to the start after the full cycle", () => {
    expect(rotateVoice(3)).toBe("male-d")
    expect(rotateVoice(4)).toBe("male-e")
    expect(rotateVoice(5)).toBe("female-c")
  })

  it("normalizes negative and fractional sequences instead of throwing", () => {
    expect(rotateVoice(-1)).toBe("female-c")
    expect(rotateVoice(-3)).toBe("male-d")
    expect(rotateVoice(1.9)).toBe("male-e")
  })

  it("only ever returns voices in the rotation set", () => {
    for (let s = 0; s < 30; s++) {
      expect(VOICE_ROTATION).toContain(rotateVoice(s))
    }
  })
})

describe("rotateFilter", () => {
  it("rotates splittone → grain → tealorange and wraps (seq 0 keeps the approved look)", () => {
    expect(rotateFilter(0)).toBe("splittone")
    expect(rotateFilter(1)).toBe("grain")
    expect(rotateFilter(2)).toBe("tealorange")
    expect(rotateFilter(3)).toBe("splittone")
  })

  it("normalizes bad counters and stays inside the active set", () => {
    expect(rotateFilter(-1)).toBe("tealorange")
    for (let s = 0; s < 12; s++) {
      expect(FILTER_ROTATION).toContain(rotateFilter(s))
    }
  })
})
