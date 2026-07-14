import { describe, expect, it, vi } from "vitest"

import {
  handleTranscriptScriptureCorrectionRouteRequest,
  runTranscriptScriptureCorrectionWorkflow,
  transcriptScriptureCorrectionWorkflow,
  _internals,
} from "./transcript-scripture-correction"

const input = {
  assetId: "asset-1",
  sourceLanguage: "en",
  segments: [
    {
      start: 56,
      end: 60,
      text: "Son, the demon! Have mercy on me!",
    },
  ],
  translationContext: {
    videoTitle: "Blind Man",
    bibleReferences: ["Luke 18:38"],
  },
}

describe("transcript scripture correction workflow", () => {
  it("rejects invalid input before provider work", async () => {
    const correct = vi.fn()

    await expect(
      runTranscriptScriptureCorrectionWorkflow(
        { assetId: "", sourceLanguage: "en", segments: [] },
        { runId: "run-invalid", correct },
      ),
    ).resolves.toEqual({
      ok: false,
      mastraRunId: "run-invalid",
      reason: "invalid_input",
      retryable: false,
      message: "Transcript scripture correction input failed validation.",
    })
    expect(correct).not.toHaveBeenCalled()
  })

  it("returns correction candidates for likely Bible-story source transcript", async () => {
    const correct = vi.fn(async () => ({
      status: "reviewed" as const,
      basis: "model_knowledge" as const,
      contentDomain: "bible_story" as const,
      confidence: 0.96,
      checkedReferenceCount: 1,
      candidateCount: 1,
      flaggedCount: 0,
      likelyBibleReferences: ["Luke 18:38"],
      findings: [
        {
          action: "apply_candidate" as const,
          category: "proper_name" as const,
          segmentIndex: 0,
          start: 56,
          end: 60,
          originalText: "Son, the demon",
          correctedText: "Son of David",
          reference: "Luke 18:38",
          confidence: 0.97,
          basis: "model_knowledge" as const,
          rationale: "Blind man healing stories use this title for Jesus.",
        },
      ],
    }))

    await expect(
      runTranscriptScriptureCorrectionWorkflow(input, {
        runId: "run-correction",
        apiKey: "openrouter-key",
        detectScriptureContext: async () => ({
          contentDomain: "bible_story",
          likelyBibleReferences: ["Luke 18:38"],
          confidence: 0.9,
        }),
        correct,
      }),
    ).resolves.toMatchObject({
      ok: true,
      mastraRunId: "run-correction",
      correction: {
        status: "reviewed",
        candidateCount: 1,
        findings: [expect.objectContaining({ correctedText: "Son of David" })],
      },
    })
    expect(correct).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceLanguage: "en",
        scriptureContext: expect.objectContaining({
          contentDomain: "bible_story",
        }),
      }),
    )
  })

  it("skips non-scripture content without calling the correction model", async () => {
    const correct = vi.fn()

    await expect(
      runTranscriptScriptureCorrectionWorkflow(
        {
          ...input,
          translationContext: undefined,
        },
        {
          runId: "run-skip",
          apiKey: "openrouter-key",
          detectScriptureContext: async () => ({
            contentDomain: "other",
            likelyBibleReferences: [],
            confidence: 0.9,
          }),
          correct,
        },
      ),
    ).resolves.toMatchObject({
      ok: true,
      correction: {
        status: "skipped",
        skippedReason: "no_scripture_context",
      },
    })
    expect(correct).not.toHaveBeenCalled()
  })

  it("returns unavailable when model config is missing", async () => {
    await expect(
      runTranscriptScriptureCorrectionWorkflow(input, {
        runId: "run-config-missing",
        apiKey: "",
      }),
    ).resolves.toMatchObject({
      ok: true,
      correction: {
        status: "unavailable",
        basis: "unavailable",
        unavailableReason: "provider_config_missing",
        likelyBibleReferences: ["Luke 18:38"],
      },
    })
  })

  it("returns unavailable when provider execution fails", async () => {
    await expect(
      runTranscriptScriptureCorrectionWorkflow(input, {
        runId: "run-provider-failed",
        apiKey: "openrouter-key",
        detectScriptureContext: async () => ({
          contentDomain: "bible_story",
          likelyBibleReferences: ["Luke 18:38"],
          confidence: 0.9,
        }),
        correct: async () => {
          throw new Error("provider offline")
        },
      }),
    ).resolves.toMatchObject({
      ok: true,
      correction: {
        status: "unavailable",
        unavailableReason: "provider_failed",
      },
    })
  })

  it("keeps route auth scoped and returns typed results", async () => {
    const readJson = vi.fn(async () => input)

    const unauthorized = await handleTranscriptScriptureCorrectionRouteRequest({
      authHeader: "Bearer wrong",
      serviceKeys: ["secret"],
      readJson,
    })

    expect(unauthorized).toEqual({
      status: 401,
      body: { error: "Service bearer required" },
    })
    expect(readJson).not.toHaveBeenCalled()

    const authorized = await handleTranscriptScriptureCorrectionRouteRequest({
      authHeader: "Bearer secret",
      serviceKeys: ["secret"],
      readJson,
      launch: async () => ({
        ok: true,
        mastraRunId: "run-route",
        correction: {
          status: "reviewed",
          basis: "model_knowledge",
          contentDomain: "bible_story",
          confidence: 0.96,
          checkedReferenceCount: 1,
          candidateCount: 0,
          flaggedCount: 0,
          likelyBibleReferences: ["Luke 18:38"],
          findings: [],
        },
      }),
    })

    expect(authorized.status).toBe(200)
    expect(authorized.body.result).toMatchObject({
      ok: true,
      mastraRunId: "run-route",
    })
  })

  it("returns a 400 result for malformed route JSON", async () => {
    const result = await handleTranscriptScriptureCorrectionRouteRequest({
      authHeader: "Bearer secret",
      serviceKeys: ["secret"],
      readJson: async () => {
        throw new Error("bad json")
      },
    })

    expect(result.status).toBe(400)
    expect(result.body.result).toMatchObject({
      ok: false,
      reason: "invalid_input",
      retryable: false,
      message: "Transcript scripture correction request body must be JSON.",
    })
  })

  it("parses workflow failure payloads defensively", () => {
    const parsed = _internals.workflowFailureFromUnknown(
      new Error(
        `${_internals.WORKFLOW_FAILURE_ERROR_PREFIX}${JSON.stringify({
          ok: false,
          mastraRunId: "run-1",
          reason: "workflow_failed",
          retryable: true,
        })}`,
      ),
    )

    expect(parsed).toEqual({
      ok: false,
      mastraRunId: "run-1",
      reason: "workflow_failed",
      retryable: true,
    })
    expect(
      _internals.workflowFailureFromUnknown(
        new Error(`${_internals.WORKFLOW_FAILURE_ERROR_PREFIX}{not json`),
      ),
    ).toBeNull()
  })

  it("registers the committed Mastra workflow", () => {
    expect(transcriptScriptureCorrectionWorkflow.id).toBe(
      "transcript-scripture-correction",
    )
    expect(transcriptScriptureCorrectionWorkflow.committed).toBe(true)
  })
})
