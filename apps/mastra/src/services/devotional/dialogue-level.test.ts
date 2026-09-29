import { describe, expect, it } from "vitest"

import { CLIP_LEVEL_MAX, CLIP_LEVEL_MIN, levelToMatch } from "./dialogue-level"

describe("levelToMatch", () => {
  it("turns a louder film down to the narration", () => {
    // Vineyard: dialogue -17.3 LUFS, narration -20.1 LUFS.
    expect(levelToMatch(-17.3, -20.1)).toBeCloseTo(0.724, 3)
  })

  it("turns a quieter film up", () => {
    expect(levelToMatch(-26, -20)).toBeCloseTo(1.995, 3)
  })

  it("leaves matched levels alone", () => {
    expect(levelToMatch(-20, -20)).toBe(1)
  })

  it("clamps implausible gains", () => {
    expect(levelToMatch(-5, -40)).toBe(CLIP_LEVEL_MIN)
    expect(levelToMatch(-50, -10)).toBe(CLIP_LEVEL_MAX)
  })
})
