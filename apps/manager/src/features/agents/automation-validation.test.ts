import { describe, expect, it } from "vitest"

import { validateAutomationDraft } from "./automation-contract"

const baseDraft = {
  name: "Missing subtitles",
  template: "metadata_missing",
  refreshMode: "missing_only",
  schedule: { kind: "every_minute", timezone: "UTC" },
  targetLanguageIds: [],
  maxVideosPerRun: 2,
}

describe("validateAutomationDraft", () => {
  it("requires target languages only for the enabled target subtitle template", () => {
    expect(
      validateAutomationDraft({
        ...baseDraft,
        template: "target_subtitles_missing",
        targetLanguageIds: [],
      }).success,
    ).toBe(false)

    expect(
      validateAutomationDraft({
        ...baseDraft,
        template: "metadata_missing",
        targetLanguageIds: [],
      }).success,
    ).toBe(true)
  })

  it("rejects invalid or later-missing target language ids clearly", () => {
    expect(
      validateAutomationDraft(
        {
          ...baseDraft,
          template: "target_subtitles_missing",
          targetLanguageIds: ["529", "missing"],
        },
        ["529"],
      ).success,
    ).toBe(false)
  })

  it("rejects transcript embedding templates until coverage-backed eligibility is available", () => {
    expect(
      validateAutomationDraft({
        ...baseDraft,
        template: "transcript_embeddings_missing",
      }).success,
    ).toBe(false)
  })

  it("limits target subtitle automations to one language for V1", () => {
    expect(
      validateAutomationDraft({
        ...baseDraft,
        template: "target_subtitles_missing",
        targetLanguageIds: ["529"],
      }).success,
    ).toBe(true)

    expect(
      validateAutomationDraft({
        ...baseDraft,
        template: "target_subtitles_missing",
        targetLanguageIds: ["529", "6414"],
      }).success,
    ).toBe(false)
  })

  it("enforces a positive per-cycle cap", () => {
    expect(
      validateAutomationDraft({
        ...baseDraft,
        maxVideosPerRun: 0,
      }).success,
    ).toBe(false)
  })
})
