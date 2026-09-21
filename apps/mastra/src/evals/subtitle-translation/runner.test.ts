import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, describe, expect, it } from "vitest"

import { retimeChunk } from "../../services/subtitle-enrichment/retimer"
import { detectSubtitleScriptureContext } from "../../services/subtitle-enrichment/scripture-context"
import { validateSubtitleScriptureAccuracy } from "../../services/subtitle-enrichment/scripture-validation"
import { prepareSubtitleEvalCorpus } from "./corpus"
import { runSubtitleEval, runSubtitleEvalCell } from "./runner"
import { SUBTITLE_EVAL_WORKFLOW_POLICY_DIGEST } from "./workflow-policy"

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  )
})

describe("subtitle eval runner", () => {
  it("executes one in-memory cell through the production enrichment seam", async () => {
    const sourceVtt =
      "WEBVTT\n\n00:00:00.000 --> 00:00:03.000\nGood news.\n\n00:00:03.000 --> 00:00:06.000\nFor everyone.\n"
    const result = await runSubtitleEvalCell(
      {
        cellId: "cell-1",
        sourceLanguage: "en",
        targetLanguage: "es",
        sourceVtt,
        referenceVtt: sourceVtt,
        clipStartSeconds: 0,
        clipEndSeconds: 6,
        model: "fixture/model",
        timeoutMs: 60_000,
      },
      {
        deps: {
          detectScriptureContext: async (input) => {
            input.onProviderCall?.(providerIdentity("generation-detection"))
            input.onUsage?.({
              promptTokens: 3,
              completionTokens: 1,
              totalTokens: 4,
            })
            return {
              contentDomain: "bible_story",
              likelyBibleReferences: ["John 3:16"],
              confidence: 1,
            }
          },
          translate: async ({ chunk, onProviderCall, onUsage }) => {
            onProviderCall?.(providerIdentity("generation-translation"))
            const usage = {
              promptTokens: 2,
              completionTokens: 3,
              totalTokens: 5,
            }
            onUsage?.(usage)
            return { text: chunk.sourceText, usage }
          },
          retime: async ({ chunk, onProviderCall, onUsage }) => {
            onProviderCall?.(providerIdentity("generation-retiming"))
            const usage = {
              promptTokens: 1,
              completionTokens: 1,
              totalTokens: 2,
            }
            onUsage?.(usage)
            return {
              segments: chunk.segments,
              usage,
              fallbackUsed: false,
            }
          },
          loadBiblePassage: async () => ({
            ok: false,
            reason: "bible_mapping_missing",
          }),
          validateScripture: async (input) => {
            input.onProviderCall?.(providerIdentity("generation-validation"))
            input.onUsage?.({
              promptTokens: 5,
              completionTokens: 2,
              totalTokens: 7,
            })
            return {
              targetLanguage: input.targetLanguage,
              contentDomain: input.scriptureContext.contentDomain,
              likelyBibleReferences:
                input.scriptureContext.likelyBibleReferences,
              verdict: "pass",
              basis: "model_knowledge",
              confidence: 1,
              checkedReferenceCount: 1,
              warningCount: 0,
              needsReviewCount: 0,
              findings: [],
            }
          },
          loadConfig: async () => undefined,
        },
      },
    )

    expect(result.candidateVtt).toContain("WEBVTT")
    expect(result.metrics.text.characterNgramFScore).toBe(1)
    expect(result.providerCalls).toEqual([
      expect.objectContaining({
        callSequence: 1,
        operation: "scripture_detection",
        providerResponseId: "generation-detection",
      }),
      expect.objectContaining({
        callSequence: 2,
        operation: "translation",
        providerResponseId: "generation-translation",
      }),
      expect.objectContaining({
        callSequence: 3,
        operation: "retiming",
        providerResponseId: "generation-retiming",
      }),
      expect.objectContaining({
        callSequence: 4,
        operation: "scripture_validation",
        providerResponseId: "generation-validation",
      }),
    ])
    expect(result.usage).toEqual({
      promptTokens: 11,
      completionTokens: 7,
      totalTokens: 18,
      retimeFallbackCount: 0,
      operations: {
        scriptureDetection: {
          promptTokens: 3,
          completionTokens: 1,
          totalTokens: 4,
          providerResponseCount: 1,
          unaccountedResponseCount: 0,
          accounting: "instrumented",
        },
        translation: {
          promptTokens: 2,
          completionTokens: 3,
          totalTokens: 5,
          providerResponseCount: 1,
          unaccountedResponseCount: 0,
          accounting: "instrumented",
        },
        retiming: {
          promptTokens: 1,
          completionTokens: 1,
          totalTokens: 2,
          providerResponseCount: 1,
          unaccountedResponseCount: 0,
          accounting: "instrumented",
        },
        scriptureValidation: {
          promptTokens: 5,
          completionTokens: 2,
          totalTokens: 7,
          providerResponseCount: 1,
          unaccountedResponseCount: 0,
          accounting: "instrumented",
        },
      },
      coverage: {
        status: "complete",
        missingOperations: [],
      },
    })
  })

  it("marks a successful cell partial when a paid operation cannot report usage", async () => {
    const sourceVtt = "WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nGood news.\n"
    const zeroUsage = {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
    }
    const result = await runSubtitleEvalCell(
      {
        cellId: "cell-partial",
        sourceLanguage: "en",
        targetLanguage: "es",
        sourceVtt,
        referenceVtt: sourceVtt,
        clipStartSeconds: 0,
        clipEndSeconds: 1,
        model: "fixture/model",
        apiKey: "fixture-key",
        timeoutMs: 60_000,
      },
      {
        deps: {
          detectScriptureContext: (input) =>
            detectSubtitleScriptureContext({
              ...input,
              fetchImpl: async () => {
                throw new Error("detector transport failure")
              },
            }),
          translate: async ({ chunk, onUsage }) => {
            onUsage?.(zeroUsage)
            return { text: chunk.sourceText, usage: zeroUsage }
          },
          retime: async ({ chunk, onUsage }) => {
            onUsage?.(zeroUsage)
            return {
              segments: chunk.segments,
              usage: zeroUsage,
              fallbackUsed: false,
            }
          },
          loadConfig: async () => undefined,
        },
      },
    )

    expect(result.usage.coverage).toEqual({
      status: "partial",
      missingOperations: ["scripture_detection"],
    })
    expect(result.usage.operations.scriptureDetection).toMatchObject({
      accounting: "unavailable",
      providerResponseCount: 0,
      unaccountedResponseCount: 1,
    })
  })

  it("counts every unavailable retimer retry before deterministic fallback", async () => {
    const sourceVtt = "WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nGood news.\n"
    const zeroUsage = {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
    }
    const result = await runSubtitleEvalCell(
      {
        cellId: "cell-retime-partial",
        sourceLanguage: "en",
        targetLanguage: "es",
        sourceVtt,
        referenceVtt: sourceVtt,
        clipStartSeconds: 0,
        clipEndSeconds: 1,
        model: "fixture/model",
        apiKey: "fixture-key",
        timeoutMs: 60_000,
      },
      {
        deps: {
          detectScriptureContext: async (input) => {
            input.onUsage?.(zeroUsage)
            return {
              contentDomain: "other",
              likelyBibleReferences: [],
              confidence: 1,
            }
          },
          translate: async ({ chunk, onUsage }) => {
            onUsage?.(zeroUsage)
            return { text: chunk.sourceText, usage: zeroUsage }
          },
          retime: (input) =>
            retimeChunk({
              ...input,
              fetchImpl: async () =>
                new Response("provider unavailable", { status: 503 }),
            }),
          loadConfig: async () => undefined,
        },
      },
    )

    expect(result.usage.coverage).toEqual({
      status: "partial",
      missingOperations: ["retiming"],
    })
    expect(result.usage.retimeFallbackCount).toBe(1)
    expect(result.usage.operations.retiming).toMatchObject({
      accounting: "unavailable",
      providerResponseCount: 0,
      unaccountedResponseCount: 2,
    })
  })

  it("marks swallowed scripture-validator failures as partial usage", async () => {
    const sourceVtt = "WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nGood news.\n"
    const zeroUsage = {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
    }
    const result = await runSubtitleEvalCell(
      {
        cellId: "cell-validator-partial",
        sourceLanguage: "en",
        targetLanguage: "es",
        sourceVtt,
        referenceVtt: sourceVtt,
        clipStartSeconds: 0,
        clipEndSeconds: 1,
        model: "fixture/model",
        apiKey: "fixture-key",
        timeoutMs: 60_000,
      },
      {
        deps: {
          detectScriptureContext: async (input) => {
            input.onUsage?.(zeroUsage)
            return {
              contentDomain: "bible_story",
              likelyBibleReferences: ["John 3:16"],
              confidence: 1,
            }
          },
          translate: async ({ chunk, onUsage }) => {
            onUsage?.(zeroUsage)
            return { text: chunk.sourceText, usage: zeroUsage }
          },
          retime: async ({ chunk, onUsage }) => {
            onUsage?.(zeroUsage)
            return {
              segments: chunk.segments,
              usage: zeroUsage,
              fallbackUsed: false,
            }
          },
          loadBiblePassage: async () => ({
            ok: false,
            reason: "bible_mapping_missing",
          }),
          validateScripture: (input) =>
            validateSubtitleScriptureAccuracy({
              ...input,
              fetchImpl: async () =>
                new Response("provider unavailable", { status: 503 }),
            }),
          loadConfig: async () => undefined,
        },
      },
    )

    expect(result.usage.coverage).toEqual({
      status: "partial",
      missingOperations: ["scripture_validation"],
    })
    expect(result.usage.operations.scriptureValidation).toMatchObject({
      accounting: "unavailable",
      providerResponseCount: 0,
      unaccountedResponseCount: 1,
    })
  })

  it("executes the production subtitle runtime contract with fixture providers", async () => {
    const directory = await mkdtemp(join(tmpdir(), "subtitle-eval-runner-"))
    temporaryDirectories.push(directory)
    const manifestPath = join(directory, "manifest.json")
    const lockPath = join(directory, "corpus.lock.json")
    const corpusDirectory = join(directory, "corpus")
    const outputDirectory = join(directory, "runs")
    await writeFile(
      manifestPath,
      JSON.stringify({
        schemaVersion: "subtitle-translation-eval/v1",
        referenceAuthority: "provisional",
        referenceNotes: "Test reference.",
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
            clip: { startSeconds: 0, endSeconds: 6 },
          },
        ],
      }),
    )
    const vtt =
      "WEBVTT\n\n00:00:00.000 --> 00:00:03.000\nGood news.\n\n00:00:03.000 --> 00:00:06.000\nFor everyone.\n"
    await prepareSubtitleEvalCorpus({
      manifestPath,
      lockPath,
      corpusDirectory,
      refreshLock: true,
      fetchImpl: async (_url, init) =>
        init?.method === "POST"
          ? Response.json({
              data: {
                videoSubtitles: [
                  coreRow("subtitle-en", "529", true),
                  coreRow("subtitle-es", "21028", false),
                ],
              },
            })
          : new Response(vtt),
      now: () => new Date("2026-08-20T00:00:00.000Z"),
    })

    const result = await runSubtitleEval(
      {
        manifestPath,
        lockPath,
        corpusDirectory,
        outputDirectory,
        model: "fixture/model",
        timeoutMs: 1000,
        concurrency: 1,
        now: () => new Date("2026-08-20T01:00:00.000Z"),
        runId: "fixture-run",
      },
      {
        deps: {
          detectScriptureContext: async () => ({
            contentDomain: "other",
            likelyBibleReferences: [],
            confidence: 1,
          }),
          translate: async ({ chunk }) => ({
            text: chunk.sourceText,
            usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
          }),
          retime: async ({ chunk }) => ({
            segments: chunk.segments,
            usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
            fallbackUsed: false,
          }),
          loadConfig: async () => undefined,
        },
      },
    )

    expect(result.report.summary).toEqual({
      completed: 1,
      failed: 0,
      structuralPassed: 1,
      structuralFailed: 0,
      humanReviewPending: 1,
    })
    expect(result.report.cases[0]?.metrics?.text.characterNgramFScore).toBe(1)
    expect(result.report.cases[0]?.humanReview.status).toBe("pending")
    expect(result.report.runtimePolicySha256).toBe(
      SUBTITLE_EVAL_WORKFLOW_POLICY_DIGEST,
    )
  })
})

function providerIdentity(providerResponseId: string) {
  return {
    status: "SUCCEEDED" as const,
    requestDigest: "d".repeat(64),
    providerRequestId: null,
    providerResponseId,
    requestedModel: "fixture/model",
    resolvedModel: "provider/resolved-model",
    operationAttempt: 0,
    usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
  }
}

function coreRow(id: string, languageId: string, primary: boolean) {
  return {
    id,
    videoId: "video-1",
    languageId,
    primary,
    edition: "base",
    vttSrc: `https://api-media-core.jesusfilm.org/video-1/${languageId}.vtt`,
    updatedAt: "2026-08-20T00:00:00.000Z",
    videoEdition: { id: "edition-1" },
  }
}
