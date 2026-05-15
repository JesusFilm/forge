import { describe, expect, it } from "vitest"
import { formatDuration } from "@/lib/format-duration"
import type { SearchResult } from "@/lib/search"
import { formatVideoLabel, pickCardPill } from "./VideoCard"

function makeResult(overrides: Partial<SearchResult> = {}): SearchResult {
  return {
    type: "video",
    id: "v_1",
    slug: "x",
    title: "X",
    imageUrl: null,
    snippet: "",
    startSeconds: null,
    playbackId: null,
    score: 0,
    label: "EPISODE",
    durationSeconds: 120,
    childCount: 0,
    ...overrides,
  }
}

describe("formatVideoLabel", () => {
  it("formats single-word labels", () => {
    expect(formatVideoLabel("EPISODE")).toBe("Episode")
    expect(formatVideoLabel("SERIES")).toBe("Series")
    expect(formatVideoLabel("SEGMENT")).toBe("Segment")
  })

  it("formats multi-word labels with space separators", () => {
    expect(formatVideoLabel("SHORT_FILM")).toBe("Short Film")
    expect(formatVideoLabel("FEATURE_FILM")).toBe("Feature Film")
  })

  it("lowercases trailing connectives (the / and / of)", () => {
    expect(formatVideoLabel("BEHIND_THE_SCENES")).toBe("Behind the Scenes")
  })

  it("falls back to 'Video' on null", () => {
    expect(formatVideoLabel(null)).toBe("Video")
  })
})

describe("formatDuration", () => {
  it("renders sub-hour durations as m:ss", () => {
    expect(formatDuration(0)).toBe("0:00")
    expect(formatDuration(7)).toBe("0:07")
    expect(formatDuration(70)).toBe("1:10")
    expect(formatDuration(599)).toBe("9:59")
  })

  it("renders hour+ durations as h:mm:ss", () => {
    expect(formatDuration(3600)).toBe("1:00:00")
    expect(formatDuration(3725)).toBe("1:02:05")
  })

  it("returns empty string on invalid input", () => {
    expect(formatDuration(NaN)).toBe("")
    expect(formatDuration(-5)).toBe("")
  })
})

describe("pickCardPill", () => {
  it("picks episode count when childCount > 0 (singular vs plural)", () => {
    expect(
      pickCardPill(makeResult({ childCount: 13, durationSeconds: 70 })),
    ).toEqual({
      kind: "count",
      text: "13 episodes",
    })
    expect(
      pickCardPill(makeResult({ childCount: 1, durationSeconds: 70 })),
    ).toEqual({
      kind: "count",
      text: "1 episode",
    })
  })

  it("falls through to duration when no children", () => {
    expect(
      pickCardPill(makeResult({ childCount: 0, durationSeconds: 70 })),
    ).toEqual({
      kind: "duration",
      text: "1:10",
    })
  })

  it("returns null when childCount is null AND durationSeconds is null (experiences)", () => {
    expect(
      pickCardPill(
        makeResult({
          type: "experience",
          label: null,
          childCount: null,
          durationSeconds: null,
        }),
      ),
    ).toBeNull()
  })

  it("returns null when durationSeconds is 0 — empty pill is worse than no pill", () => {
    expect(
      pickCardPill(makeResult({ childCount: 0, durationSeconds: 0 })),
    ).toBeNull()
  })

  it("prefers childCount over duration when both are set", () => {
    expect(
      pickCardPill(makeResult({ childCount: 13, durationSeconds: 70 }))!.kind,
    ).toBe("count")
  })
})
