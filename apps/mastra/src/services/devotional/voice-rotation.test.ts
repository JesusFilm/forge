import { describe, expect, it } from "vitest"

import { rotateFilter, rotateVoice } from "./voice-rotation"

const VOICE_ROTATION = ["male-d", "male-e", "female-c"]
const FILTER_ROTATION = ["splittone", "grain", "tealorange"]

describe("rotateVoice", () => {
  it("rotates D -> E -> C across consecutive devotionals", () => {
    expect(rotateVoice(0, VOICE_ROTATION)).toBe("male-d")
    expect(rotateVoice(1, VOICE_ROTATION)).toBe("male-e")
    expect(rotateVoice(2, VOICE_ROTATION)).toBe("female-c")
  })

  it("wraps back to the start after the full cycle", () => {
    expect(rotateVoice(3, VOICE_ROTATION)).toBe("male-d")
    expect(rotateVoice(4, VOICE_ROTATION)).toBe("male-e")
    expect(rotateVoice(5, VOICE_ROTATION)).toBe("female-c")
  })

  it("normalizes negative and fractional sequences instead of throwing", () => {
    expect(rotateVoice(-1, VOICE_ROTATION)).toBe("female-c")
    expect(rotateVoice(-3, VOICE_ROTATION)).toBe("male-d")
    expect(rotateVoice(1.9, VOICE_ROTATION)).toBe("male-e")
  })

  it("only ever returns voices in the rotation set", () => {
    for (let s = 0; s < 30; s++) {
      expect(VOICE_ROTATION).toContain(rotateVoice(s, VOICE_ROTATION))
    }
  })
})

describe("rotateFilter", () => {
  it("rotates splittone → grain → tealorange and wraps (seq 0 keeps the approved look)", () => {
    expect(rotateFilter(0, FILTER_ROTATION)).toBe("splittone")
    expect(rotateFilter(1, FILTER_ROTATION)).toBe("grain")
    expect(rotateFilter(2, FILTER_ROTATION)).toBe("tealorange")
    expect(rotateFilter(3, FILTER_ROTATION)).toBe("splittone")
  })

  it("normalizes bad counters and stays inside the active set", () => {
    expect(rotateFilter(-1, FILTER_ROTATION)).toBe("tealorange")
    for (let s = 0; s < 12; s++) {
      expect(FILTER_ROTATION).toContain(rotateFilter(s, FILTER_ROTATION))
    }
  })
})
