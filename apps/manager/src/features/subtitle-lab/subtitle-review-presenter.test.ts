import { describe, expect, it } from "vitest"

import {
  alignSubtitleSegments,
  boundSegmentWindow,
  navigateSegmentIndex,
  parseWebVtt,
} from "./subtitle-review-presenter"

describe("subtitle review presenter", () => {
  it("parses international WebVTT cues without treating cue indexes as identity", () => {
    const cues = parseWebVtt(
      `\uFEFFWEBVTT\n\nNOTE frozen fixture\nignore me\n\n1\n00:00:01.000 --> 00:00:02.500 align:start\nمرحبا <b>بالعالم</b>\n\ncue-cjk\n00:00:03.000 --> 00:00:04.000\n救いの知らせ 👋🏽\n`,
    )

    expect(cues).toEqual([
      {
        id: "cue-1",
        startSeconds: 1,
        endSeconds: 2.5,
        text: "مرحبا بالعالم",
      },
      {
        id: "cue-2",
        startSeconds: 3,
        endSeconds: 4,
        text: "救いの知らせ 👋🏽",
      },
    ])
  })

  it("builds connected overlap groups for one-to-many tracks and source context", () => {
    const segments = alignSubtitleSegments({
      source: [
        { id: "s1", startSeconds: 0.8, endSeconds: 3.2, text: "Source" },
      ],
      trackA: [{ id: "a1", startSeconds: 1, endSeconds: 3, text: "One cue" }],
      trackB: [
        { id: "b1", startSeconds: 1, endSeconds: 2, text: "First" },
        { id: "b2", startSeconds: 2, endSeconds: 3, text: "Second" },
      ],
      locale: "ar",
    })

    expect(segments).toHaveLength(1)
    expect(segments[0]).toMatchObject({
      id: "segment-0001",
      startSeconds: 0.8,
      endSeconds: 3.2,
      sourceText: "Source",
      trackAText: "One cue",
      trackBText: "First\nSecond",
      lexicalDifference: true,
      timingDifference: false,
    })
  })

  it("keeps missing source or one comparison track representable", () => {
    const segments = alignSubtitleSegments({
      source: [],
      trackA: [],
      trackB: [
        { id: "b1", startSeconds: 4, endSeconds: 5, text: "孤独な字幕" },
      ],
      locale: "ja",
    })

    expect(segments[0]).toMatchObject({
      sourceText: "",
      trackAText: "",
      trackBText: "孤独な字幕",
    })
  })

  it("does not merge cues that only touch at a boundary", () => {
    const segments = alignSubtitleSegments({
      source: [],
      trackA: [{ id: "a1", startSeconds: 0, endSeconds: 2, text: "First" }],
      trackB: [{ id: "b1", startSeconds: 2, endSeconds: 4, text: "Second" }],
      locale: "en",
    })

    expect(segments.map((segment) => segment.id)).toEqual([
      "segment-0001",
      "segment-0002",
    ])
  })

  it("preserves deterministic source-only connected components", () => {
    const segments = alignSubtitleSegments({
      source: [
        { id: "s1", startSeconds: 0, endSeconds: 2, text: "One" },
        { id: "s2", startSeconds: 1, endSeconds: 3, text: "Two" },
        { id: "s3", startSeconds: 3, endSeconds: 4, text: "Three" },
      ],
      trackA: [],
      trackB: [],
      locale: "en",
    })

    expect(segments).toEqual([
      expect.objectContaining({
        id: "segment-0001",
        sourceText: "One\nTwo",
        startSeconds: 0,
        endSeconds: 3,
      }),
      expect.objectContaining({
        id: "segment-0002",
        sourceText: "Three",
        startSeconds: 3,
        endSeconds: 4,
      }),
    ])
  })

  it("bounds navigation and loop windows", () => {
    expect(navigateSegmentIndex(0, -1, 3)).toBe(0)
    expect(navigateSegmentIndex(0, 1, 3)).toBe(1)
    expect(navigateSegmentIndex(2, 1, 3)).toBe(2)
    expect(
      boundSegmentWindow(10, 90, { startSeconds: 12, endSeconds: 80 }),
    ).toEqual({
      startSeconds: 12,
      endSeconds: 42,
    })
  })
})
