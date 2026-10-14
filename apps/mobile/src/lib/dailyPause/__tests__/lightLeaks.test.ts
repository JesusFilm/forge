import {
  LIGHT_LEAK_CROSSFADE,
  LIGHT_LEAK_CURVE,
  LIGHT_LEAK_FLASH_MS,
  LIGHT_LEAK_GAP_MS,
  LIGHT_LEAK_SHAPES,
  lightLeakGapMs,
  lightLeaksSupported,
  pickLightLeakShape,
} from "../lightLeaks"

describe("lightLeakGapMs", () => {
  it("waits between the shortest and the longest gap", () => {
    expect(lightLeakGapMs(() => 0)).toBe(LIGHT_LEAK_GAP_MS.min)
    expect(lightLeakGapMs(() => 0.999999)).toBe(LIGHT_LEAK_GAP_MS.max)
    expect(lightLeakGapMs(() => 0.5)).toBe(
      (LIGHT_LEAK_GAP_MS.min + LIGHT_LEAK_GAP_MS.max) / 2,
    )
  })

  it("is quiet for longer than a flash lasts", () => {
    expect(LIGHT_LEAK_GAP_MS.min).toBeGreaterThan(LIGHT_LEAK_FLASH_MS)
  })
})

describe("pickLightLeakShape", () => {
  const draws = [0, 0.2, 0.3, 0.49, 0.5, 0.75, 0.999999]

  it("never repeats the last leak", () => {
    for (const previous of LIGHT_LEAK_SHAPES) {
      for (const draw of draws) {
        expect(pickLightLeakShape(previous, () => draw)).not.toBe(previous)
      }
    }
  })

  it("can give every leak for the first flash", () => {
    const seen = new Set(
      draws.map((draw) => pickLightLeakShape(null, () => draw)),
    )
    expect([...seen].sort()).toEqual([...LIGHT_LEAK_SHAPES].sort())
  })
})

describe("LIGHT_LEAK_CURVE", () => {
  const { inputRange, outputRange } = LIGHT_LEAK_CURVE

  it("starts and ends dark, and peaks at full strength", () => {
    expect(inputRange[0]).toBe(0)
    expect(inputRange.at(-1)).toBe(1)
    expect(outputRange[0]).toBe(0)
    expect(outputRange.at(-1)).toBe(0)
    expect(Math.max(...outputRange)).toBe(1)
    for (let at = 1; at < inputRange.length; at += 1) {
      expect(inputRange[at]!).toBeGreaterThan(inputRange[at - 1]!)
    }
  })

  // WCAG 2.3.1: fewer than three flashes in any one second.
  it("rises fewer than three times a second", () => {
    let rises = 0
    for (let at = 1; at < outputRange.length; at += 1) {
      const before = outputRange[at - 1]!
      const after = outputRange[at]!
      const wasFalling = at === 1 || outputRange[at - 2]! >= before
      if (after > before && wasFalling) rises += 1
    }
    expect(rises / (LIGHT_LEAK_FLASH_MS / 1000)).toBeLessThan(3)
  })
})

describe("LIGHT_LEAK_CROSSFADE", () => {
  it("shows the first frame at the rise and the second before the fade", () => {
    const { inputRange, outputRange } = LIGHT_LEAK_CROSSFADE
    const peakAt =
      LIGHT_LEAK_CURVE.inputRange[LIGHT_LEAK_CURVE.outputRange.indexOf(1)]!
    expect(outputRange).toEqual([0, 1])
    expect(inputRange[0]).toBeGreaterThanOrEqual(peakAt)
    expect(inputRange[1]).toBeLessThan(1)
  })
})

describe("lightLeaksSupported", () => {
  // React Native's mixBlendMode needs Android 10 (API 29).
  it("runs on iOS and on Android 10 and later only", () => {
    expect(lightLeaksSupported("ios", "26.0")).toBe(true)
    expect(lightLeaksSupported("android", 29)).toBe(true)
    expect(lightLeaksSupported("android", 36)).toBe(true)
    expect(lightLeaksSupported("android", 28)).toBe(false)
    expect(lightLeaksSupported("android", 24)).toBe(false)
  })
})
