import { computeTypographyScale } from "./useTypography"

// -- Pure function tests ------------------------------------------------------

describe("computeTypographyScale", () => {
  it("returns exact BASE_SCALE values at reference width (375)", () => {
    const result = computeTypographyScale(375)

    expect(result.caption).toEqual({ fontSize: 12, lineHeight: 16 })
    expect(result.bodySmall).toEqual({ fontSize: 14, lineHeight: 20 })
    expect(result.body).toEqual({ fontSize: 16, lineHeight: 24 })
    expect(result.titleSmall).toEqual({ fontSize: 18, lineHeight: 24 })
    expect(result.titleLarge).toEqual({ fontSize: 22, lineHeight: 28 })
    expect(result.heading).toEqual({ fontSize: 24, lineHeight: 32 })
    expect(result.display).toEqual({ fontSize: 32, lineHeight: 40 })
  })

  it("clamps at MIN_FACTOR (0.85) for narrow screens", () => {
    const result = computeTypographyScale(300)

    // factor = 300/375 = 0.8, clamped to 0.85
    expect(result.body.fontSize).toBe(Math.round(16 * 0.85)) // 14
    expect(result.body.lineHeight).toBe(Math.round(24 * 0.85)) // 20
    expect(result.heading.fontSize).toBe(Math.round(24 * 0.85)) // 20
  })

  it("clamps at MAX_FACTOR (1.15) for wide screens", () => {
    const result = computeTypographyScale(500)

    // factor = 500/375 = 1.33, clamped to 1.15
    expect(result.body.fontSize).toBe(Math.round(16 * 1.15)) // 18
    expect(result.body.lineHeight).toBe(Math.round(24 * 1.15)) // 28
    expect(result.heading.fontSize).toBe(Math.round(24 * 1.15)) // 28
  })

  it("scales proportionally at mid-range width (414) without clamping", () => {
    const result = computeTypographyScale(414)

    // factor = 414/375 ≈ 1.104, within [0.85, 1.15]
    const factor = 414 / 375
    expect(result.body.fontSize).toBe(Math.round(16 * factor)) // 18
    expect(result.body.lineHeight).toBe(Math.round(24 * factor)) // 27
    expect(result.caption.fontSize).toBe(Math.round(12 * factor)) // 13
  })

  it("produces integer fontSize and lineHeight for all tokens", () => {
    for (const width of [300, 320, 375, 393, 414, 430, 500, 768]) {
      const result = computeTypographyScale(width)

      for (const key of Object.keys(result) as (keyof typeof result)[]) {
        if (key === "headingScale") continue
        const token = result[key]
        expect(Number.isInteger(token.fontSize)).toBe(true)
        expect(Number.isInteger(token.lineHeight)).toBe(true)
      }
    }
  })

  it("includes all 6 heading levels in headingScale with numeric values", () => {
    const result = computeTypographyScale(375)
    const keys = Object.keys(result.headingScale)

    expect(keys).toEqual(
      expect.arrayContaining(["h1", "h2", "h3", "h4", "h5", "h6"]),
    )
    expect(keys).toHaveLength(6)

    for (const level of ["h1", "h2", "h3", "h4", "h5", "h6"] as const) {
      expect(typeof result.headingScale[level].fontSize).toBe("number")
      expect(typeof result.headingScale[level].lineHeight).toBe("number")
    }
  })

  it("returns all 7 named tokens plus headingScale", () => {
    const result = computeTypographyScale(375)
    const keys = Object.keys(result)

    expect(keys).toEqual(
      expect.arrayContaining([
        "caption",
        "bodySmall",
        "body",
        "titleSmall",
        "titleLarge",
        "heading",
        "display",
        "headingScale",
      ]),
    )
  })

  it("maintains lineHeight >= fontSize for every token at all widths", () => {
    for (const width of [300, 375, 500]) {
      const result = computeTypographyScale(width)

      for (const key of Object.keys(result) as (keyof typeof result)[]) {
        if (key === "headingScale") {
          for (const [, token] of Object.entries(result.headingScale)) {
            expect(token.lineHeight >= token.fontSize).toBe(true)
          }
        } else {
          const token = result[key]
          expect((token.lineHeight ?? 0) >= (token.fontSize ?? 0)).toBe(true)
        }
      }
    }
  })

  it("heading scale matches expected values at base width", () => {
    const result = computeTypographyScale(375)

    expect(result.headingScale.h1).toEqual({ fontSize: 32, lineHeight: 40 })
    expect(result.headingScale.h2).toEqual({ fontSize: 28, lineHeight: 36 })
    expect(result.headingScale.h3).toEqual({ fontSize: 24, lineHeight: 32 })
    expect(result.headingScale.h4).toEqual({ fontSize: 20, lineHeight: 28 })
    expect(result.headingScale.h5).toEqual({ fontSize: 18, lineHeight: 24 })
    expect(result.headingScale.h6).toEqual({ fontSize: 16, lineHeight: 22 })
  })
})
