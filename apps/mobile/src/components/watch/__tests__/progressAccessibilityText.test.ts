import { getT } from "../../../i18n/useT"
import { progressAccessibilityText } from "../WatchProgressBar"

const at = (positionSeconds: number) => ({
  positionSeconds,
  durationSeconds: 100,
})

describe("progressAccessibilityText", () => {
  it("says nothing below 1%", () => {
    expect(progressAccessibilityText(null)).toBeNull()
    expect(progressAccessibilityText(at(0.5))).toBeNull()
  })

  it("reads the English text byte-identical", () => {
    expect(progressAccessibilityText(at(42))).toBe("42% watched")
    expect(progressAccessibilityText(at(95))).toBe("watched")
  })

  it("uses the translator the card passes", () => {
    const t = jest.fn(getT("Watch"))
    expect(progressAccessibilityText(at(42), t)).toBe("42% watched")
    expect(t).toHaveBeenCalledWith("percentWatchedAriaLabel", { percent: 42 })
  })
})
