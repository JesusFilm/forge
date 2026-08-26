import {
  QUALITY_TIERS,
  applyQualityConstraint,
  sameQualityConstraint,
  supportsQualityConstraint,
  type QualityTier,
} from "../streamQuality"

const MUX_URL = "https://stream.mux.com/abc123.m3u8"

function params(url: string): Record<string, string> {
  const result: Record<string, string> = {}
  new URL(url).searchParams.forEach((value, name) => {
    result[name] = value
  })
  return result
}

describe("QUALITY_TIERS", () => {
  it("lists auto first and the three constrained tiers", () => {
    expect(QUALITY_TIERS).toEqual(["auto", "low", "high", "highest"])
  })
})

describe("applyQualityConstraint", () => {
  it("maps low to a 480p resolution cap", () => {
    expect(params(applyQualityConstraint(MUX_URL, "low"))).toEqual({
      max_resolution: "480p",
    })
  })

  it("maps high to a 720p resolution cap", () => {
    expect(params(applyQualityConstraint(MUX_URL, "high"))).toEqual({
      max_resolution: "720p",
    })
  })

  it("maps highest to a 1080p resolution floor (R7)", () => {
    expect(params(applyQualityConstraint(MUX_URL, "highest"))).toEqual({
      min_resolution: "1080p",
    })
  })

  it("appends nothing for auto (R6)", () => {
    expect(applyQualityConstraint(MUX_URL, "auto")).toBe(MUX_URL)
  })

  it("composes with an existing query string without corrupting it", () => {
    const constrained = applyQualityConstraint(
      `${MUX_URL}?token=abc.def`,
      "low",
    )
    expect(params(constrained)).toEqual({
      token: "abc.def",
      max_resolution: "480p",
    })
    expect(new URL(constrained).pathname).toBe("/abc123.m3u8")
  })

  it("constrains a Mux URL with a trailing newline after cleaning", () => {
    const constrained = applyQualityConstraint(`${MUX_URL}\n`, "high")
    expect(/\s/.test(constrained)).toBe(false)
    expect(params(constrained)).toEqual({ max_resolution: "720p" })
  })

  it("replaces a previous constraint instead of stacking a second one", () => {
    const low = applyQualityConstraint(MUX_URL, "low")
    expect(params(applyQualityConstraint(low, "highest"))).toEqual({
      min_resolution: "1080p",
    })
    expect(params(applyQualityConstraint(low, "high"))).toEqual({
      max_resolution: "720p",
    })
  })

  it.each(QUALITY_TIERS.map((tier) => [tier] as [QualityTier]))(
    "passes a non-Mux https URL through untouched for %s",
    (tier) => {
      const url = "https://cdn.example.com/video.m3u8?token=abc"
      expect(applyQualityConstraint(url, tier)).toBe(url)
    },
  )

  it.each(QUALITY_TIERS.map((tier) => [tier] as [QualityTier]))(
    "passes an offline file:// path through untouched for %s",
    (tier) => {
      const url = "file:///var/mobile/offline/birth-of-jesus.mp4"
      expect(applyQualityConstraint(url, tier)).toBe(url)
    },
  )

  it.each(QUALITY_TIERS.map((tier) => [tier] as [QualityTier]))(
    "passes an unparseable value through untouched for %s",
    (tier) => {
      expect(applyQualityConstraint("not a url", tier)).toBe("not a url")
    },
  )
})

describe("supportsQualityConstraint", () => {
  it("supports a Mux https stream", () => {
    expect(supportsQualityConstraint(MUX_URL)).toBe(true)
  })

  it("supports a Mux stream carrying a query string", () => {
    expect(supportsQualityConstraint(`${MUX_URL}?token=abc.def`)).toBe(true)
  })

  it("supports a whitespace-tainted Mux URL (cleaned first)", () => {
    expect(supportsQualityConstraint(`${MUX_URL}\n`)).toBe(true)
  })

  it("rejects a non-Mux https stream", () => {
    expect(
      supportsQualityConstraint("https://cdn.example.com/video.m3u8"),
    ).toBe(false)
  })

  it("rejects an offline file:// source (R11)", () => {
    expect(
      supportsQualityConstraint(
        "file:///var/mobile/offline/birth-of-jesus.mp4",
      ),
    ).toBe(false)
  })

  it("rejects null and an unparseable value", () => {
    expect(supportsQualityConstraint(null)).toBe(false)
    expect(supportsQualityConstraint("not a url")).toBe(false)
  })
})

describe("sameQualityConstraint", () => {
  it("treats two same-asset URLs with no constraints as equal", () => {
    expect(sameQualityConstraint(MUX_URL, MUX_URL)).toBe(true)
  })

  it("treats different tiers as unequal", () => {
    const low = applyQualityConstraint(MUX_URL, "low")
    const high = applyQualityConstraint(MUX_URL, "high")
    const highest = applyQualityConstraint(MUX_URL, "highest")
    expect(sameQualityConstraint(low, high)).toBe(false)
    expect(sameQualityConstraint(low, highest)).toBe(false)
    expect(sameQualityConstraint(MUX_URL, low)).toBe(false)
  })

  it("treats the same tier applied to both sides as equal", () => {
    const a = applyQualityConstraint(MUX_URL, "highest")
    const b = applyQualityConstraint(MUX_URL, "highest")
    expect(sameQualityConstraint(a, b)).toBe(true)
  })

  it("ignores unrelated params", () => {
    expect(
      sameQualityConstraint(`${MUX_URL}?token=aaa`, `${MUX_URL}?token=bbb`),
    ).toBe(true)
    expect(
      sameQualityConstraint(
        applyQualityConstraint(`${MUX_URL}?token=aaa`, "low"),
        applyQualityConstraint(MUX_URL, "low"),
      ),
    ).toBe(true)
  })

  it("treats an auto-applied URL as equal to the raw URL", () => {
    expect(
      sameQualityConstraint(applyQualityConstraint(MUX_URL, "auto"), MUX_URL),
    ).toBe(true)
  })

  it("cleans whitespace before comparing", () => {
    const constrained = applyQualityConstraint(MUX_URL, "low")
    expect(sameQualityConstraint(`${constrained}\n`, constrained)).toBe(true)
  })
})
