import { describe, expect, it } from "vitest"

import { SubtitleValidationSummarySchema } from "@/lib/subtitle-validation"
import {
  normalizeTranscriptScriptureCorrectionStepSummary,
  TranscriptScriptureCorrectionStepSummarySchema,
} from "@/lib/transcript-scripture-correction"

describe("transcript scripture correction summary", () => {
  it("parses an applied correction summary", () => {
    expect(
      TranscriptScriptureCorrectionStepSummarySchema.parse({
        status: "applied",
        basis: "model_knowledge",
        contentDomain: "bible_story",
        confidence: 0.94,
        checkedReferenceCount: 1,
        appliedCount: 1,
        flaggedCount: 0,
        likelyBibleReferences: ["Luke 18:38"],
        findings: [
          {
            action: "applied",
            category: "proper_name",
            segmentIndex: 7,
            start: 56,
            end: 60,
            originalText: "Son, the demon",
            correctedText: "Son of David",
            reference: "Luke 18:38",
            confidence: 0.96,
            basis: "model_knowledge",
            rationale: "Blind man healing stories use this title for Jesus.",
          },
        ],
      }),
    ).toMatchObject({
      status: "applied",
      appliedCount: 1,
      flaggedCount: 0,
    })
  })

  it("normalizes skipped and unavailable summaries", () => {
    expect(
      normalizeTranscriptScriptureCorrectionStepSummary({
        status: "skipped",
        basis: "model_knowledge",
        contentDomain: "other",
        confidence: 0.1,
        checkedReferenceCount: 0,
        appliedCount: 0,
        flaggedCount: 0,
        skippedReason: "no_scripture_context",
        likelyBibleReferences: [],
        findings: [],
      }),
    ).toMatchObject({ status: "skipped" })

    expect(
      normalizeTranscriptScriptureCorrectionStepSummary({
        status: "unavailable",
        basis: "unavailable",
        contentDomain: "christian_general",
        confidence: 0,
        checkedReferenceCount: 0,
        appliedCount: 0,
        flaggedCount: 0,
        unavailableReason: "provider_config_missing",
        likelyBibleReferences: [],
        findings: [],
      }),
    ).toMatchObject({ status: "unavailable" })
  })

  it("rejects missing indexes and mismatched counts", () => {
    expect(
      normalizeTranscriptScriptureCorrectionStepSummary({
        status: "applied",
        basis: "model_knowledge",
        contentDomain: "bible_story",
        confidence: 0.94,
        checkedReferenceCount: 1,
        appliedCount: 2,
        flaggedCount: 0,
        likelyBibleReferences: ["Luke 18:38"],
        findings: [
          {
            action: "applied",
            category: "proper_name",
            start: 56,
            end: 60,
            originalText: "Son, the demon",
            correctedText: "Son of David",
            confidence: 0.96,
            basis: "model_knowledge",
            rationale: "Missing segment index should fail.",
          },
        ],
      }),
    ).toBeUndefined()
  })

  it("does not change translated subtitle validation summary parsing", () => {
    expect(
      SubtitleValidationSummarySchema.parse({
        verdict: "warning",
        basis: "model_knowledge",
        confidence: 0.7,
        checkedReferenceCount: 1,
        warningCount: 1,
        needsReviewCount: 0,
      }),
    ).toMatchObject({ verdict: "warning" })
  })
})
