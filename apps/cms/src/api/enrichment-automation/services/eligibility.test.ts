import { describe, expect, it } from "vitest"

import {
  buildAutomationKey,
  filterEligibleCandidates,
  templateRequiresTargetLanguages,
} from "./eligibility"

describe("templateRequiresTargetLanguages", () => {
  it("requires target languages only for target subtitles automations", () => {
    expect(templateRequiresTargetLanguages("target_subtitles_missing")).toBe(
      true,
    )
    expect(templateRequiresTargetLanguages("source_subtitles_missing")).toBe(
      false,
    )
    expect(templateRequiresTargetLanguages("metadata_missing")).toBe(false)
    expect(
      templateRequiresTargetLanguages("transcript_embeddings_missing"),
    ).toBe(false)
    expect(templateRequiresTargetLanguages("scene_embeddings_missing")).toBe(
      false,
    )
  })
})

describe("filterEligibleCandidates", () => {
  it("includes missing and AI-owned outputs for refresh mode but never human-owned outputs", () => {
    const candidates = filterEligibleCandidates(
      [
        { videoDocumentId: "missing", outputOwner: "missing" },
        { videoDocumentId: "ai", outputOwner: "ai" },
        { videoDocumentId: "human", outputOwner: "human" },
      ],
      {
        refreshMode: "refresh_ai_generated",
        maxVideosPerRun: 10,
        runningAutomationKeys: new Set(),
        buildKey: (candidate) =>
          buildAutomationKey({
            template: "metadata_missing",
            videoDocumentId: candidate.videoDocumentId,
            targetLanguageIds: [],
          }),
      },
    )

    expect(candidates.map((candidate) => candidate.videoDocumentId)).toEqual([
      "missing",
      "ai",
    ])
  })

  it("respects per-cycle caps and skips duplicate pending/running keys", () => {
    const duplicateKey = buildAutomationKey({
      template: "target_subtitles_missing",
      videoDocumentId: "video-2",
      targetLanguageIds: ["6414", "529"],
    })

    const candidates = filterEligibleCandidates(
      [
        { videoDocumentId: "video-1", outputOwner: "missing" },
        { videoDocumentId: "video-2", outputOwner: "missing" },
        { videoDocumentId: "video-3", outputOwner: "missing" },
      ],
      {
        refreshMode: "missing_only",
        maxVideosPerRun: 1,
        runningAutomationKeys: new Set([duplicateKey]),
        buildKey: (candidate) =>
          buildAutomationKey({
            template: "target_subtitles_missing",
            videoDocumentId: candidate.videoDocumentId,
            targetLanguageIds: ["529", "6414"],
          }),
      },
    )

    expect(candidates.map((candidate) => candidate.videoDocumentId)).toEqual([
      "video-1",
    ])
  })
})
