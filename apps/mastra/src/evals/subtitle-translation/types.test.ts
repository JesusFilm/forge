import { describe, expect, it } from "vitest"

import {
  SUBTITLE_EVAL_MAX_CUES_PER_TRACK,
  SUBTITLE_EVAL_MAX_PROVIDER_CALLS_PER_CELL,
  SubtitleEvalCloudUsageSchema,
  SubtitleEvalManifestSchema,
} from "./types"

const validManifest = {
  schemaVersion: "subtitle-translation-eval/v1",
  referenceAuthority: "provisional",
  referenceNotes: "Awaiting curator approval.",
  sourceLanguage: "en",
  targetLanguages: ["es"],
  languages: [
    { bcp47: "en", coreLanguageId: "529", label: "English" },
    { bcp47: "es", coreLanguageId: "21028", label: "Spanish" },
  ],
  cases: [
    {
      id: "sample",
      videoId: "video-1",
      title: "Sample",
      collection: "Tests",
      edition: "base",
      coreVideoEditionId: "edition-1",
      clip: { startSeconds: 0, endSeconds: 10 },
    },
  ],
} as const

describe("subtitle eval manifest", () => {
  it("pins the cloud cell cue and provider-call spend bounds", () => {
    expect(SUBTITLE_EVAL_MAX_CUES_PER_TRACK).toBe(80)
    expect(SUBTITLE_EVAL_MAX_PROVIDER_CALLS_PER_CELL).toBe(64)
  })

  it("accepts a complete versioned manifest", () => {
    expect(SubtitleEvalManifestSchema.parse(validManifest).cases).toHaveLength(
      1,
    )
  })

  it("rejects duplicate cases and undefined target languages", () => {
    const result = SubtitleEvalManifestSchema.safeParse({
      ...validManifest,
      targetLanguages: ["fr"],
      cases: [...validManifest.cases, validManifest.cases[0]],
    })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues.map((issue) => issue.message)).toEqual(
        expect.arrayContaining([
          "Missing language definition for target: fr",
          "Duplicate case id: sample",
        ]),
      )
    }
  })
})

describe("subtitle eval cloud usage", () => {
  it("rejects aggregate token totals that do not match operation accounting", () => {
    const emptyOperation = {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      providerResponseCount: 0,
      unaccountedResponseCount: 0,
      accounting: "not_invoked",
    }
    const result = SubtitleEvalCloudUsageSchema.safeParse({
      promptTokens: 1,
      completionTokens: 0,
      totalTokens: 1,
      retimeFallbackCount: 0,
      operations: {
        scriptureDetection: emptyOperation,
        translation: emptyOperation,
        retiming: emptyOperation,
        scriptureValidation: emptyOperation,
      },
      coverage: { status: "complete", missingOperations: [] },
    })

    expect(result.success).toBe(false)
  })
})
