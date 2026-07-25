import {
  buildMetadataLine,
  buildShareUrl,
  formatDuration,
} from "./detailsHelpers"

describe("formatDuration", () => {
  it("formats sub-hour durations as M:SS", () => {
    expect(formatDuration(0.5)).toBeNull() // floors to 0 → non-positive
    expect(formatDuration(5)).toBe("0:05")
    expect(formatDuration(65)).toBe("1:05")
    expect(formatDuration(600)).toBe("10:00")
  })

  it("formats hour-plus durations as H:MM:SS", () => {
    expect(formatDuration(3661)).toBe("1:01:01")
    expect(formatDuration(7325)).toBe("2:02:05")
  })

  it("returns null for non-positive / non-finite / null", () => {
    expect(formatDuration(0)).toBeNull()
    expect(formatDuration(-5)).toBeNull()
    expect(formatDuration(null)).toBeNull()
    expect(formatDuration(undefined)).toBeNull()
    expect(formatDuration(Number.NaN)).toBeNull()
  })
})

describe("buildMetadataLine", () => {
  it("joins label · duration · languages with a middle dot", () => {
    expect(buildMetadataLine("SEGMENT", 600, 12)).toBe(
      "SEGMENT  ·  10:00  ·  12 languages",
    )
  })

  it("singularizes one language", () => {
    expect(buildMetadataLine("SEGMENT", null, 1)).toBe("SEGMENT  ·  1 language")
  })

  it("omits absent segments", () => {
    expect(buildMetadataLine(null, 600, null)).toBe("10:00")
    expect(buildMetadataLine("SEGMENT", null, null)).toBe("SEGMENT")
    expect(buildMetadataLine("  ", null, 0)).toBeNull()
  })

  it("returns null when nothing to show", () => {
    expect(buildMetadataLine(null, null, null)).toBeNull()
    expect(buildMetadataLine(null, 0, 0)).toBeNull()
  })
})

describe("buildShareUrl", () => {
  it("builds the base watch URL", () => {
    expect(buildShareUrl({ slug: "birth-of-jesus" }, null)).toBe(
      "https://www.jesusfilm.org/watch/birth-of-jesus.html",
    )
    expect(buildShareUrl({ slug: "russian" }, null)).toBe(
      "https://www.jesusfilm.org/watch/russian.html/english.html",
    )
  })

  it("appends the active language slug when present", () => {
    expect(buildShareUrl({ slug: "birth-of-jesus" }, "spanish")).toBe(
      "https://www.jesusfilm.org/watch/birth-of-jesus.html/spanish.html",
    )
  })

  it("omits eligible English and preserves collision-owned explicit English", () => {
    expect(buildShareUrl({ slug: "birth-of-jesus" }, "english")).toBe(
      "https://www.jesusfilm.org/watch/birth-of-jesus.html",
    )
    expect(buildShareUrl({ slug: "russian" }, "english")).toBe(
      "https://www.jesusfilm.org/watch/russian.html/english.html",
    )
  })

  it("returns null when there is no slug", () => {
    expect(buildShareUrl(null, "spanish")).toBeNull()
    expect(buildShareUrl({ slug: "" }, "spanish")).toBeNull()
  })
})
