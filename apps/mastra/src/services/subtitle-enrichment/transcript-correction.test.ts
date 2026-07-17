import { describe, expect, it, vi } from "vitest"

import {
  buildUnavailableTranscriptScriptureCorrectionResult,
  correctTranscriptScripture,
  _internals,
} from "./transcript-correction"
import type { SubtitleScriptureContext } from "./types"

const scriptureContext: SubtitleScriptureContext = {
  contentDomain: "bible_story",
  likelyBibleReferences: ["Luke 18:38"],
  confidence: 0.88,
}

function openRouterJson(value: unknown) {
  return Response.json({
    choices: [{ message: { content: JSON.stringify(value) } }],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  })
}

describe("correctTranscriptScripture", () => {
  it("returns a high-confidence candidate for the blind-man ASR drift", async () => {
    const fetchImpl = vi.fn(async () =>
      openRouterJson({
        confidence: 0.96,
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
            confidence: 0.97,
            basis: "model_knowledge",
            rationale: "Blind man healing stories use this title for Jesus.",
          },
        ],
      }),
    )

    await expect(
      correctTranscriptScripture({
        sourceLanguage: "en",
        segments: [
          { start: 56, end: 60, text: "Son, the demon! Have mercy on me!" },
        ],
        scriptureContext,
        model: "test-model",
        apiKey: "openrouter-key",
        timeoutMs: 30_000,
        fetchImpl,
      }),
    ).resolves.toMatchObject({
      status: "reviewed",
      basis: "model_knowledge",
      candidateCount: 1,
      flaggedCount: 0,
      findings: [
        expect.objectContaining({
          action: "apply_candidate",
          originalText: "Son, the demon",
          correctedText: "Son of David",
        }),
      ],
    })
  })

  it("can return a contextual post-healing correction candidate", async () => {
    const fetchImpl = vi.fn(async () =>
      openRouterJson({
        confidence: 0.91,
        likelyBibleReferences: ["Luke 18:42-43"],
        findings: [
          {
            action: "apply_candidate",
            category: "negation_drift",
            segmentIndex: 12,
            start: 82,
            end: 86,
            originalText: "I can't see",
            correctedText: "I can see",
            reference: "Luke 18:42-43",
            confidence: 0.93,
            basis: "model_knowledge",
            rationale: "The healing has just happened in this story.",
          },
        ],
      }),
    )

    await expect(
      correctTranscriptScripture({
        sourceLanguage: "en",
        segments: [
          { start: 72, end: 79, text: "Then see." },
          { start: 79, end: 82, text: "Your faith has made you well." },
          { start: 82, end: 86, text: "I can't see." },
        ],
        scriptureContext,
        model: "test-model",
        apiKey: "openrouter-key",
        timeoutMs: 30_000,
        fetchImpl,
      }),
    ).resolves.toMatchObject({
      candidateCount: 1,
      findings: [
        expect.objectContaining({
          category: "negation_drift",
          correctedText: "I can see",
        }),
      ],
    })
  })

  it("keeps uncertain suggestions flag-only", async () => {
    const fetchImpl = vi.fn(async () =>
      openRouterJson({
        confidence: 0.55,
        likelyBibleReferences: [],
        findings: [
          {
            action: "flag_only",
            category: "uncertain_reference",
            segmentIndex: 0,
            start: 0,
            end: 3,
            originalText: "kingdom words",
            confidence: 0.55,
            basis: "model_knowledge",
            rationale:
              "Christian language is present but no exact story is clear.",
          },
        ],
      }),
    )

    await expect(
      correctTranscriptScripture({
        sourceLanguage: "en",
        segments: [{ start: 0, end: 3, text: "kingdom words" }],
        scriptureContext: {
          contentDomain: "christian_general",
          likelyBibleReferences: [],
          confidence: 0.4,
        },
        model: "test-model",
        apiKey: "openrouter-key",
        timeoutMs: 30_000,
        fetchImpl,
      }),
    ).resolves.toMatchObject({
      candidateCount: 0,
      flaggedCount: 1,
      findings: [expect.objectContaining({ action: "flag_only" })],
    })
  })

  it("does not claim source Bible text basis unless a source passage was supplied", async () => {
    const fetchImpl = vi.fn(async () =>
      openRouterJson({
        confidence: 0.9,
        likelyBibleReferences: ["Luke 18:38"],
        findings: [
          {
            action: "apply_candidate",
            category: "scripture_phrase",
            segmentIndex: 0,
            start: 56,
            end: 60,
            originalText: "Son, the demon",
            correctedText: "Son of David",
            reference: "Luke 18:38",
            confidence: 0.92,
            basis: "source_bible_text",
            rationale: "The likely Bible story uses this messianic title.",
          },
        ],
      }),
    )

    await expect(
      correctTranscriptScripture({
        sourceLanguage: "en",
        segments: [
          { start: 56, end: 60, text: "Son, the demon! Have mercy on me!" },
        ],
        scriptureContext,
        model: "test-model",
        apiKey: "openrouter-key",
        timeoutMs: 30_000,
        fetchImpl,
      }),
    ).resolves.toMatchObject({
      basis: "model_knowledge",
      findings: [
        expect.objectContaining({
          basis: "model_knowledge",
        }),
      ],
    })
  })

  it("builds unavailable results without findings or prompt text", () => {
    expect(
      buildUnavailableTranscriptScriptureCorrectionResult({
        scriptureContext,
        unavailableReason: "provider_failed",
      }),
    ).toEqual({
      status: "unavailable",
      basis: "unavailable",
      contentDomain: "bible_story",
      confidence: 0,
      checkedReferenceCount: 0,
      candidateCount: 0,
      flaggedCount: 0,
      unavailableReason: "provider_failed",
      likelyBibleReferences: ["Luke 18:38"],
      findings: [],
    })
  })

  it("keeps correction prompts compact and segment-indexed", () => {
    const messages = _internals.buildCorrectionMessages({
      sourceLanguage: "en",
      segments: [{ start: 56, end: 60, text: "Son, the demon!" }],
      scriptureContext,
      model: "test-model",
      timeoutMs: 30_000,
    })

    expect(messages.system).toContain("obvious ASR drift")
    expect(messages.user).toContain("[0] 56.00-60.00 Son, the demon!")
  })
})
