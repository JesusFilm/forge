import { describe, expect, it } from "vitest"

import { DEFAULT_FILTER, rotateVoice, VOICE_ROTATION } from "./voice-rotation"

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

describe("DEFAULT_FILTER", () => {
  it("is the one grade the series uses, so nothing varies by sequence", () => {
    expect(DEFAULT_FILTER).toBe("restored")
  })
})
