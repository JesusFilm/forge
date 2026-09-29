import { getT } from "../../../i18n/useT"
import { progressAccessibilityText } from "../WatchProgressBar"

const at = (positionSeconds: number) => ({
  positionSeconds,
  durationSeconds: 100,
})

const t = getT("Watch")

describe("progressAccessibilityText", () => {
  it("says nothing below 1%", () => {
    expect(progressAccessibilityText(null, t)).toBeNull()
    expect(progressAccessibilityText(at(0.5), t)).toBeNull()
  })

  it("reads the English text byte-identical, through the card's translator", () => {
    const spy = jest.fn(t)
    expect(progressAccessibilityText(at(42), spy)).toBe("42% watched")
    expect(progressAccessibilityText(at(95), spy)).toBe("watched")
    expect(spy).toHaveBeenCalledWith("percentWatchedAriaLabel", { percent: 42 })
  })
})
