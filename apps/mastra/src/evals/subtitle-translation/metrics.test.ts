import { describe, expect, it } from "vitest"

import { characterNgramFScore, compareSubtitleCues } from "./metrics"

describe("subtitle eval metrics", () => {
  it("does not penalize equivalent text solely for different cue segmentation", () => {
    const source = [
      { start: 0, end: 5, text: "The good news" },
      { start: 5, end: 10, text: "is for everyone." },
    ]
    const reference = [
      { start: 0, end: 2, text: "The" },
      { start: 2, end: 6, text: "good news is" },
      { start: 6, end: 10, text: "for everyone." },
    ]

    const metrics = compareSubtitleCues({
      source,
      generated: source,
      reference,
      clipStartSeconds: 0,
      clipEndSeconds: 10,
    })

    expect(metrics.structural.passed).toBe(true)
    expect(metrics.text.characterNgramFScore).toBe(1)
    expect(metrics.timing.referenceOverlapRecall).toBe(1)
  })

  it("reports overlaps and missing source-speech coverage as structural failures", () => {
    const metrics = compareSubtitleCues({
      source: [
        { start: 0, end: 4, text: "one" },
        { start: 6, end: 10, text: "two" },
      ],
      generated: [
        { start: 0, end: 2, text: "uno" },
        { start: 1, end: 3, text: "dos" },
      ],
      reference: [{ start: 0, end: 10, text: "uno dos" }],
      clipStartSeconds: 0,
      clipEndSeconds: 10,
    })

    expect(metrics.structural.passed).toBe(false)
    expect(metrics.structural.failures).toContain("cue_1:overlaps_previous_cue")
    expect(metrics.structural.failures).toContain(
      "source_speech_coverage_below_human_reference_floor",
    )
  })

  it("keeps multilingual character similarity bounded", () => {
    expect(characterNgramFScore("Jesús te ama", "Jesús te ama")).toBe(1)
    expect(characterNgramFScore("Jesús te ama", "Другая строка")).toBe(0)
  })

  it("calibrates source coverage to a human reference below the ideal", () => {
    const source = [{ start: 0, end: 10, text: "Source" }]
    const reference = [{ start: 0, end: 9.4, text: "Reference" }]

    const metrics = compareSubtitleCues({
      source,
      generated: reference,
      reference,
      clipStartSeconds: 0,
      clipEndSeconds: 10,
    })

    expect(metrics.structural.passed).toBe(false)
    expect(metrics.structural.failures).toContain(
      "cue_0:duration_exceeds_7_5_seconds",
    )
    expect(metrics.structural.failures).not.toContain(
      "source_speech_coverage_below_human_reference_floor",
    )
    expect(metrics.structural.warnings).toContain(
      "human_reference_source_coverage_below_0_95",
    )
  })
})
