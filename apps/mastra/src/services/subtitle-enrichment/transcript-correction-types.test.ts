import { describe, expect, it } from "vitest"

import {
  TranscriptScriptureCorrectionResultSchema,
  TranscriptScriptureCorrectionModelOutputSchema,
} from "./transcript-correction-types"
import { SubtitleScriptureValidationSummarySchema } from "./types"

describe("transcript correction types", () => {
  it("parses a reviewed result with an apply candidate", () => {
    expect(
      TranscriptScriptureCorrectionResultSchema.parse({
        status: "reviewed",
        basis: "model_knowledge",
        contentDomain: "bible_story",
        confidence: 0.94,
        checkedReferenceCount: 1,
        candidateCount: 1,
        flaggedCount: 0,
        likelyBibleReferences: ["Luke 18:38"],
        findings: [
          {
            action: "apply_candidate",
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
      status: "reviewed",
      candidateCount: 1,
      flaggedCount: 0,
    })
  })

  it("parses skipped and unavailable outcomes without findings", () => {
    expect(
      TranscriptScriptureCorrectionResultSchema.parse({
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
      }),
    ).toMatchObject({ status: "skipped" })

    expect(
      TranscriptScriptureCorrectionResultSchema.parse({
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
      }),
    ).toMatchObject({ status: "unavailable" })
  })

  it("rejects malformed or unbounded findings", () => {
    expect(() =>
      TranscriptScriptureCorrectionModelOutputSchema.parse({
        confidence: 0.9,
        likelyBibleReferences: ["Luke 18:38"],
        findings: [
          {
            action: "apply_candidate",
            category: "proper_name",
            start: 56,
            end: 60,
            originalText: "Son, the demon",
            confidence: 0.96,
            basis: "model_knowledge",
            rationale: "Missing segment index should fail.",
          },
        ],
      }),
    ).toThrow()

    expect(() =>
      TranscriptScriptureCorrectionResultSchema.parse({
        status: "reviewed",
        basis: "model_knowledge",
        contentDomain: "bible_story",
        confidence: 0.94,
        checkedReferenceCount: 1,
        candidateCount: 1,
        flaggedCount: 0,
        likelyBibleReferences: ["Luke 18:38"],
        findings: [
          {
            action: "apply_candidate",
            category: "proper_name",
            segmentIndex: 7,
            start: 56,
            end: 60,
            originalText: "Son, the demon",
            confidence: 0.96,
            basis: "model_knowledge",
            rationale: "Corrected text is required for apply candidates.",
          },
        ],
      }),
    ).toThrow()
  })

  it("does not change translated subtitle validation summary parsing", () => {
    expect(
      SubtitleScriptureValidationSummarySchema.parse({
        verdict: "needs_review",
        basis: "model_knowledge",
        confidence: 0.7,
        checkedReferenceCount: 1,
        warningCount: 0,
        needsReviewCount: 1,
      }),
    ).toMatchObject({ verdict: "needs_review" })
  })
})
