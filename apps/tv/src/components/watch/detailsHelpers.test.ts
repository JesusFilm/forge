import {
  buildMetadataLine,
  buildShareUrl,
  formatBadgeLabel,
  formatDuration,
  formatResumeLabel,
  shouldOfferResumeChoice,
  shouldShowUpNextRail,
} from "./detailsHelpers"

describe("shouldShowUpNextRail", () => {
  const chapter = { documentId: "ch-1" } as never

  // A film with chapters shows the chapter rail INSTEAD of Up Next, never both.
  it("hides Up Next when the video has its own chapters", () => {
    expect(shouldShowUpNextRail({ chapters: [chapter] })).toBe(false)
    expect(
      shouldShowUpNextRail({ chapters: [chapter, chapter, chapter] }),
    ).toBe(false)
  })

  it("keeps Up Next for an ordinary video with no chapters", () => {
    expect(shouldShowUpNextRail({ chapters: [] })).toBe(true)
  })

  it("shows nothing before the record resolves", () => {
    expect(shouldShowUpNextRail(null)).toBe(false)
    expect(shouldShowUpNextRail(undefined)).toBe(false)
  })
})

describe("formatBadgeLabel", () => {
  // Without the split the badge renders the raw enum, underscore and all —
  // "FEATURE_FILM" instead of "FEATURE FILM". The style uppercases; this only
  // has to unpick the underscores.
  it("turns a multi-word wire enum into badge text", () => {
    expect(formatBadgeLabel("FEATURE_FILM")).toBe("FEATURE FILM")
    expect(formatBadgeLabel("SHORT_FILM")).toBe("SHORT FILM")
    expect(formatBadgeLabel("BEHIND_THE_SCENES")).toBe("BEHIND THE SCENES")
  })

  it("passes single-word enums through untouched", () => {
    expect(formatBadgeLabel("SERIES")).toBe("SERIES")
    expect(formatBadgeLabel("EPISODE")).toBe("EPISODE")
  })

  it("yields null when there is no label to show (no badge chip)", () => {
    expect(formatBadgeLabel(null)).toBeNull()
    expect(formatBadgeLabel(undefined)).toBeNull()
    expect(formatBadgeLabel("")).toBeNull()
    expect(formatBadgeLabel("   ")).toBeNull()
    expect(formatBadgeLabel("__")).toBeNull()
  })
})

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

describe("shouldOfferResumeChoice", () => {
  it("offers the choice only for a real saved position", () => {
    expect(shouldOfferResumeChoice(754)).toBe(true)
  })

  // One case per rejection clause: each of these must play directly with no
  // chooser rather than force a dialog on garbage.
  it.each([
    ["null", null],
    ["undefined", undefined],
    ["zero", 0],
    ["negative", -5],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
  ])("does not offer for %s", (_label, value) => {
    expect(shouldOfferResumeChoice(value)).toBe(false)
  })
})

describe("formatResumeLabel", () => {
  it("formats minutes:seconds under an hour", () => {
    expect(formatResumeLabel(754)).toBe("Resume from 12:34")
    expect(formatResumeLabel(62)).toBe("Resume from 1:02")
  })

  it("formats h:mm:ss past the hour", () => {
    expect(formatResumeLabel(3722)).toBe("Resume from 1:02:02")
  })

  it("floors fractional seconds and clamps negatives", () => {
    expect(formatResumeLabel(59.9)).toBe("Resume from 0:59")
    expect(formatResumeLabel(-3)).toBe("Resume from 0:00")
  })
})
