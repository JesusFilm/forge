import { describe, expect, it } from "vitest"

import {
  applyTranscriptScriptureCorrections,
  buildTranscriptCorrectionReport,
} from "@/services/transcript-scripture-correction"
import type { MastraTranscriptScriptureCorrection } from "@/services/mastra-transcript-scripture-correction"

const baseCorrection: MastraTranscriptScriptureCorrection = {
  status: "reviewed",
  basis: "model_knowledge",
  contentDomain: "bible_story",
  confidence: 0.96,
  checkedReferenceCount: 1,
  candidateCount: 1,
  flaggedCount: 0,
  likelyBibleReferences: ["Luke 18:38"],
  findings: [
    {
      action: "apply_candidate",
      category: "proper_name",
      segmentIndex: 0,
      start: 56,
      end: 60,
      originalText: "Son, the demon",
      correctedText: "Son of David",
      reference: "Luke 18:38",
      confidence: 0.97,
      basis: "model_knowledge",
      rationale: "Blind man healing stories use this title for Jesus.",
    },
  ],
}

describe("applyTranscriptScriptureCorrections", () => {
  it("applies exact high-confidence corrections without changing timing", () => {
    const result = applyTranscriptScriptureCorrections({
      text: "Son, the demon! Have mercy on me!",
      segments: [
        { start: 56, end: 60, text: "Son, the demon! Have mercy on me!" },
      ],
      correction: baseCorrection,
    })

    expect(result.changed).toBe(true)
    expect(result.text).toBe("Son of David! Have mercy on me!")
    expect(result.segments).toEqual([
      { start: 56, end: 60, text: "Son of David! Have mercy on me!" },
    ])
    expect(result.summary).toMatchObject({
      status: "applied",
      appliedCount: 1,
      flaggedCount: 0,
      findings: [expect.objectContaining({ action: "applied" })],
    })
  })

  it("downgrades original-text mismatches to flagged findings", () => {
    const result = applyTranscriptScriptureCorrections({
      text: "Son of David! Have mercy on me!",
      segments: [
        { start: 56, end: 60, text: "Son of David! Have mercy on me!" },
      ],
      correction: baseCorrection,
    })

    expect(result.changed).toBe(false)
    expect(result.text).toBe("Son of David! Have mercy on me!")
    expect(result.summary).toMatchObject({
      status: "flagged",
      appliedCount: 0,
      flaggedCount: 1,
      findings: [
        expect.objectContaining({
          action: "flagged",
          rationale: expect.stringContaining("exact-match"),
        }),
      ],
    })
  })

  it("downgrades low-confidence candidates to flagged findings", () => {
    const result = applyTranscriptScriptureCorrections({
      text: "I can't see.",
      segments: [{ start: 82, end: 86, text: "I can't see." }],
      correction: {
        ...baseCorrection,
        findings: [
          {
            ...baseCorrection.findings[0]!,
            category: "negation_drift",
            originalText: "I can't see",
            correctedText: "I can see",
            confidence: 0.7,
          },
        ],
      },
    })

    expect(result.changed).toBe(false)
    expect(result.summary).toMatchObject({
      status: "flagged",
      appliedCount: 0,
      flaggedCount: 1,
    })
  })

  it("preserves skipped and unavailable summaries", () => {
    expect(
      applyTranscriptScriptureCorrections({
        text: "generic transcript",
        segments: [{ start: 0, end: 1, text: "generic transcript" }],
        correction: {
          status: "skipped",
          basis: "model_knowledge",
          contentDomain: "other",
          confidence: 0.1,
          checkedReferenceCount: 0,
          candidateCount: 0,
          flaggedCount: 0,
          skippedReason: "no_scripture_context",
          likelyBibleReferences: [],
          findings: [],
        },
      }).summary,
    ).toMatchObject({
      status: "skipped",
      skippedReason: "no_scripture_context",
    })

    expect(
      applyTranscriptScriptureCorrections({
        text: "generic transcript",
        segments: [{ start: 0, end: 1, text: "generic transcript" }],
        correction: {
          status: "unavailable",
          basis: "unavailable",
          contentDomain: "christian_general",
          confidence: 0,
          checkedReferenceCount: 0,
          candidateCount: 0,
          flaggedCount: 0,
          unavailableReason: "provider_config_missing",
          likelyBibleReferences: [],
          findings: [],
        },
      }).summary,
    ).toMatchObject({
      status: "unavailable",
      unavailableReason: "provider_config_missing",
    })
  })

  it("builds a highlighted correction report without raw prompts", () => {
    const result = applyTranscriptScriptureCorrections({
      text: "Son, the demon! Have mercy on me!",
      segments: [
        { start: 56, end: 60, text: "Son, the demon! Have mercy on me!" },
      ],
      correction: baseCorrection,
    })

    expect(buildTranscriptCorrectionReport(result.summary)).toMatchObject({
      kind: "transcript-scripture-correction-report",
      version: 1,
      summary: expect.objectContaining({ appliedCount: 1 }),
      findings: [expect.objectContaining({ correctedText: "Son of David" })],
    })
  })
})
