import {
  buildStripeGradient,
  EXPERIENCE_GRADIENTS,
  experienceGradientForSlug,
} from "./experienceGradient"

describe("experienceGradientForSlug", () => {
  it("is deterministic for a given slug", () => {
    expect(experienceGradientForSlug("easter")).toBe(
      experienceGradientForSlug("easter"),
    )
  })

  it("always returns a palette from the set", () => {
    for (const slug of ["easter", "jesus", "the-hope-of-christmas", "", "a"]) {
      expect(EXPERIENCE_GRADIENTS).toContain(experienceGradientForSlug(slug))
    }
  })

  // Locks the djb2 port to web. These indices are computed by web's identical
  // gradientForSlug — a hash change would break parity and this test.
  it.each([
    ["easter", 1],
    ["the-hope-of-christmas", 6],
    ["jesus", 7],
    ["", 5],
  ])("maps %p to palette index %i (matches web)", (slug, index) => {
    expect(experienceGradientForSlug(slug)).toBe(EXPERIENCE_GRADIENTS[index])
  })

  it("distinguishes at least some different slugs", () => {
    const a = experienceGradientForSlug("easter")
    const b = experienceGradientForSlug("jesus")
    expect(a).not.toBe(b)
  })
})

describe("buildStripeGradient", () => {
  it("returns equal-length colors and locations", () => {
    const { colors, locations } = buildStripeGradient(10)
    expect(colors.length).toBe(locations.length)
    expect(colors.length).toBe(40) // 4 stops per band
  })

  it("produces locations that span [0,1] and never decrease", () => {
    const { locations } = buildStripeGradient(12)
    expect(locations[0]).toBe(0)
    expect(locations[locations.length - 1]).toBeCloseTo(1)
    for (let i = 1; i < locations.length; i++) {
      expect(locations[i]).toBeGreaterThanOrEqual(locations[i - 1])
    }
  })

  it("alternates on/off stops so bands read as stripes", () => {
    const { colors } = buildStripeGradient(3)
    expect(colors.slice(0, 4)).toEqual([
      "rgba(255,255,255,0.05)",
      "rgba(255,255,255,0.05)",
      "rgba(255,255,255,0)",
      "rgba(255,255,255,0)",
    ])
  })
})
