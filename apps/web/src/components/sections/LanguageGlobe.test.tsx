import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import {
  advanceFrameSchedule,
  LanguageGlobe,
  getLanguageGlobeRenderProfile,
  hasSmallIslandDetailNear,
  isLandCoordinate,
  projectLanguagePoint,
  shouldAnimateLanguageGlobe,
  starShimmerOpacity,
  wrapVerseText,
} from "./LanguageGlobe"
import { VERSE_TRANSLATIONS } from "./languageGlobeVerse"

describe("LanguageGlobe", () => {
  it("renders an accessible canvas with a textual fallback", () => {
    const markup = renderToStaticMarkup(<LanguageGlobe />)

    expect(markup).toContain('aria-label="Matthew 24:14 across the nations"')
    expect(markup).toContain(
      'aria-label="A rotating globe formed from Matthew 24:14 in 39 public-domain language editions"',
    )
    const describedBy = markup.match(/aria-describedby="([^"]+)"/)?.[1]
    expect(describedBy).toBeTruthy()
    expect(markup).toContain(`id="${describedBy}"`)
    expect(markup).toContain('data-testid="language-globe-canvas"')
    expect(markup).toContain("This Good News of the Kingdom")
  })

  it("uses the source verse and public-domain translations across many languages", () => {
    expect(VERSE_TRANSLATIONS).toHaveLength(39)
    expect(VERSE_TRANSLATIONS.find(({ id }) => id === "grcbyz")?.text).toBe(
      "καὶ κηρυχθήσεται τοῦτο τὸ εὐαγγέλιον τῆς βασιλείας ἐν ὅλῃ τῇ οἰκουμένῃ εἰς μαρτύριον πᾶσι τοῖς ἔθνεσι, καὶ τότε ἥξει τὸ τέλος.",
    )
    expect(VERSE_TRANSLATIONS.every(({ text }) => text.length > 20)).toBe(true)
  })

  it("wraps the complete English verse into readable caption lines", () => {
    const lines = wrapVerseText(
      "This Good News of the Kingdom will be preached in the whole world for a testimony to all the nations, and then the end will come.",
      42,
    )

    expect(lines).toEqual([
      "This Good News of the Kingdom will be",
      "preached in the whole world for a",
      "testimony to all the nations, and then the",
      "end will come.",
    ])
    expect(lines.every((line) => line.length <= 42)).toBe(true)
  })

  it("keeps a 24 fps cadence on a 60 Hz display", () => {
    const interval = 1000 / 24
    let previousFrame = 0
    let drawnFrames = 0

    for (let displayFrame = 1; displayFrame <= 60; displayFrame += 1) {
      const now = displayFrame * (1000 / 60)
      if (now - previousFrame >= interval) {
        previousFrame = advanceFrameSchedule(previousFrame, now, interval)
        drawnFrames += 1
      }
    }

    expect(drawnFrames).toBe(24)
  })

  it("wraps languages without spaces instead of clipping the verse", () => {
    expect(wrapVerseText("这天国的福音要传遍天下，对万民作见证", 8)).toEqual([
      "这天国的福音要传",
      "遍天下，对万民作",
      "见证",
    ])
  })

  it("projects the prime meridian to the front of the globe", () => {
    const point = projectLanguagePoint(
      { label: "Test", latitude: 0, longitude: 0 },
      0,
    )

    expect(point.x).toBeCloseTo(0)
    expect(point.y).toBeCloseTo(0)
    expect(point.depth).toBeCloseTo(1)
  })

  it("moves a point around the globe as rotation advances", () => {
    const point = { label: "Test", latitude: 0, longitude: 0 }
    const quarterTurn = projectLanguagePoint(point, Math.PI / 2)
    const halfTurn = projectLanguagePoint(point, Math.PI)

    expect(quarterTurn.x).toBeCloseTo(1)
    expect(quarterTurn.depth).toBeCloseTo(0)
    expect(halfTurn.depth).toBeCloseTo(-1)
  })

  it("uses the Natural Earth land mask instead of filling the whole sphere", () => {
    expect(isLandCoordinate(10, 20)).toBe(true) // Africa
    expect(isLandCoordinate(-15, -60)).toBe(true) // South America
    expect(isLandCoordinate(64, -42)).toBe(true) // Greenland
    expect(isLandCoordinate(36, 138)).toBe(true) // Japan
    expect(isLandCoordinate(0, -25)).toBe(false) // Atlantic Ocean
    expect(isLandCoordinate(-30, -120)).toBe(false) // Pacific Ocean
  })

  it("restores small island groups below the sampled land-mask resolution", () => {
    expect(hasSmallIslandDetailNear(21, -157)).toBe(true) // Hawaii
    expect(hasSmallIslandDetailNear(38.5, -28)).toBe(true) // Azores
    expect(hasSmallIslandDetailNear(13.4, 144.8)).toBe(true) // Guam
    expect(hasSmallIslandDetailNear(0, 0)).toBe(false) // Gulf of Guinea
  })

  it("keeps star shimmer subtle and within its opacity ceiling", () => {
    const samples = [0, 1000, 5000, 10000].map((elapsed) =>
      starShimmerOpacity(elapsed, 0.4, 1.2, 0.0004),
    )

    expect(samples.every((opacity) => opacity >= 0.04)).toBe(true)
    expect(samples.every((opacity) => opacity <= 0.4)).toBe(true)
    expect(new Set(samples).size).toBeGreaterThan(1)
  })

  it("reduces canvas work on mobile and constrained devices", () => {
    const desktop = getLanguageGlobeRenderProfile(1128, 8, 8)
    const iphone = getLanguageGlobeRenderProfile(390, 6, 8)
    const lowPowerAndroid = getLanguageGlobeRenderProfile(390, 4, 4)

    expect(desktop).toMatchObject({
      compactLand: false,
      densityCap: 1.5,
      frameIntervalMilliseconds: 1000 / 24,
    })
    expect(iphone).toMatchObject({
      compactLand: true,
      densityCap: 1.25,
      frameIntervalMilliseconds: 1000 / 20,
    })
    expect(lowPowerAndroid).toMatchObject({
      compactLand: true,
      densityCap: 1,
      frameIntervalMilliseconds: 1000 / 16,
    })
  })

  it("animates only after load while visible, onscreen, and motion-safe", () => {
    expect(
      shouldAnimateLanguageGlobe({
        pageLoaded: true,
        inViewport: true,
        documentVisible: true,
        reducedMotion: false,
      }),
    ).toBe(true)

    for (const blockedCondition of [
      { pageLoaded: false },
      { inViewport: false },
      { documentVisible: false },
      { reducedMotion: true },
    ]) {
      expect(
        shouldAnimateLanguageGlobe({
          pageLoaded: true,
          inViewport: true,
          documentVisible: true,
          reducedMotion: false,
          ...blockedCondition,
        }),
      ).toBe(false)
    }
  })
})
