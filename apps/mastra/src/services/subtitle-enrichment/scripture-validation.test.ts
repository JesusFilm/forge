import { describe, expect, it, vi } from "vitest"

import {
  buildUnavailableSubtitleScriptureValidationResult,
  validateSubtitleScriptureAccuracy,
  _internals,
} from "./scripture-validation"
import type { SubtitleScriptureContext } from "./types"

const scriptureContext: SubtitleScriptureContext = {
  contentDomain: "bible_story",
  likelyBibleReferences: ["Luke 2"],
  confidence: 0.87,
}

function openRouterJson(value: unknown) {
  return Response.json({
    choices: [{ message: { content: JSON.stringify(value) } }],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  })
}

describe("validateSubtitleScriptureAccuracy", () => {
  it("returns model-knowledge validation when no Bible passage is supplied", async () => {
    const fetchImpl = vi.fn(async () =>
      openRouterJson({
        verdict: "pass",
        confidence: 0.74,
        likelyBibleReferences: ["Luke 2"],
        findings: [],
      }),
    )

    await expect(
      validateSubtitleScriptureAccuracy({
        targetLanguage: "es",
        segments: [{ start: 0, end: 2, text: "Maria dio a luz a Jesus." }],
        scriptureContext,
        model: "test-model",
        apiKey: "openrouter-key",
        timeoutMs: 30_000,
        fallbackReason: "provider_config_missing",
        fetchImpl,
      }),
    ).resolves.toMatchObject({
      targetLanguage: "es",
      basis: "model_knowledge",
      verdict: "pass",
      confidence: 0.74,
      checkedReferenceCount: 1,
      fallbackReason: "provider_config_missing",
      likelyBibleReferences: ["Luke 2"],
      findings: [],
    })
  })

  it("returns target-Bible-text validation with provider provenance", async () => {
    const fetchImpl = vi.fn(async () =>
      openRouterJson({
        verdict: "needs_review",
        confidence: 0.91,
        likelyBibleReferences: ["Luke 2"],
        findings: [
          {
            severity: "needs_review",
            category: "addition",
            message: "Adds a detail not supported by the passage.",
            reference: "Luke 2",
            segmentIndexes: [0],
            evidence: "king in the stable",
          },
        ],
      }),
    )

    await expect(
      validateSubtitleScriptureAccuracy({
        targetLanguage: "es",
        segments: [
          {
            start: 0,
            end: 2,
            text: "Un rey llego al establo antes que los pastores.",
          },
        ],
        scriptureContext,
        model: "test-model",
        apiKey: "openrouter-key",
        timeoutMs: 30_000,
        biblePassage: {
          provider: {
            name: "api_bible",
            bibleId: "spa-rvr",
            language: "es",
            reference: "Lucas 2",
          },
          referenceCount: 1,
          text: "Maria dio a luz a su hijo primogenito.",
        },
        fetchImpl,
      }),
    ).resolves.toMatchObject({
      basis: "target_bible_text",
      verdict: "needs_review",
      confidence: 0.91,
      checkedReferenceCount: 1,
      needsReviewCount: 1,
      provider: {
        name: "api_bible",
        bibleId: "spa-rvr",
        reference: "Lucas 2",
      },
    })
  })

  it("promotes the verdict when findings are more severe than the model verdict", async () => {
    const fetchImpl = vi.fn(async () =>
      openRouterJson({
        verdict: "pass",
        confidence: 0.82,
        likelyBibleReferences: ["Luke 2"],
        findings: [
          {
            severity: "needs_review",
            category: "meaning_drift",
            message: "Changes the birth narrative meaning.",
          },
        ],
      }),
    )

    await expect(
      validateSubtitleScriptureAccuracy({
        targetLanguage: "es",
        segments: [{ start: 0, end: 2, text: "Jose dio a luz." }],
        scriptureContext,
        model: "test-model",
        apiKey: "openrouter-key",
        timeoutMs: 30_000,
        fetchImpl,
      }),
    ).resolves.toMatchObject({
      verdict: "needs_review",
      needsReviewCount: 1,
      warningCount: 0,
    })
  })

  it("anchors non-pass verdicts with a bounded finding when the model omits details", async () => {
    const fetchImpl = vi.fn(async () =>
      openRouterJson({
        verdict: "warning",
        confidence: 0.66,
        likelyBibleReferences: ["Luke 2"],
        findings: [],
      }),
    )

    await expect(
      validateSubtitleScriptureAccuracy({
        targetLanguage: "es",
        segments: [{ start: 0, end: 2, text: "Maria dio a luz." }],
        scriptureContext,
        model: "test-model",
        apiKey: "openrouter-key",
        timeoutMs: 30_000,
        fetchImpl,
      }),
    ).resolves.toMatchObject({
      verdict: "warning",
      warningCount: 1,
      findings: [
        expect.objectContaining({
          severity: "warning",
          category: "uncertain_reference",
          reference: "Luke 2",
        }),
      ],
    })
  })

  it("builds unavailable validation without provider text or findings", () => {
    expect(
      buildUnavailableSubtitleScriptureValidationResult({
        targetLanguage: "es",
        scriptureContext,
        unavailableReason: "provider_failed",
      }),
    ).toEqual({
      targetLanguage: "es",
      contentDomain: "bible_story",
      likelyBibleReferences: ["Luke 2"],
      verdict: "unavailable",
      basis: "unavailable",
      confidence: 0,
      checkedReferenceCount: 0,
      warningCount: 0,
      needsReviewCount: 0,
      unavailableReason: "provider_failed",
      findings: [],
    })
  })

  it("keeps validation prompts compact and labeled by basis", () => {
    const messages = _internals.buildValidationMessages({
      targetLanguage: "en",
      segments: [{ start: 0, end: 2, text: "Jesus was born." }],
      scriptureContext,
      model: "test-model",
      timeoutMs: 30_000,
    })

    expect(messages.system).toContain("No target-language Bible passage")
    expect(messages.user).toContain("[0] 0.00-2.00 Jesus was born.")
  })
})
