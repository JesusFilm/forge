import { describe, expect, it } from "vitest"

import { audioFade } from "./audio-volume"

describe("audioFade", () => {
  it("preserves requested fades when the clip is long enough", () => {
    expect(audioFade(300, 60, 39)).toEqual({
      inputRange: [0, 60, 261, 300],
      outputRange: [0, 1, 1, 0],
    })
  })

  it.each([1, 2, 30, 60])(
    "keeps a %d-frame clip range strictly increasing",
    (durationFrames) => {
      const { inputRange, outputRange } = audioFade(durationFrames, 60, 60)
      expect(outputRange).toHaveLength(inputRange.length)
      for (let index = 1; index < inputRange.length; index += 1) {
        expect(inputRange[index]).toBeGreaterThan(inputRange[index - 1])
      }
    },
  )
})
