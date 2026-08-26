import { readFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import { describe, expect, it, vi } from "vitest"

import { sha256 } from "./corpus"
import {
  loadPackagedSubtitleEvalPolicy,
  loadSubtitleEvalBuildIdentity,
  runCloudSubtitleEvalCell,
  SUBTITLE_EVAL_PROMPT_POLICY_ID,
  SUBTITLE_EVAL_WORKFLOW_POLICY_FILES,
  SUBTITLE_EVAL_WORKFLOW_POLICY_DIGEST,
  type SubtitleEvalCloudPolicy,
} from "./cloud-runner"
import type { SubtitleEvalManifest, SubtitleEvalCorpusLock } from "./types"

const sourceVtt =
  "WEBVTT\n\n00:00:00.000 --> 00:00:03.000\nGood news.\n\n00:00:03.000 --> 00:00:06.000\nFor everyone.\n"
const referenceVtt =
  "WEBVTT\n\n00:00:00.000 --> 00:00:06.000\nBuenas noticias para todos.\n"
const candidateVtt =
  "WEBVTT\n\n00:00:00.000 --> 00:00:03.000\nBuenas noticias.\n\n00:00:03.000 --> 00:00:06.000\nPara todos.\n"

describe("cloud subtitle eval cell runner", () => {
  it.each([undefined, "unknown", "   "])(
    "fails closed before paid work when production revision is %s",
    (revision) => {
      expect(() =>
        loadSubtitleEvalBuildIdentity({
          nodeEnv: "production",
          railwayRevision: revision,
        }),
      ).toThrow(/deployed code revision/i)
    },
  )

  it("pins packaged JSON byte digests used by Admin corpus import", async () => {
    const packageRoot = resolve(
      dirname(fileURLToPath(import.meta.url)),
      "../../..",
    )
    const [manifestBytes, lockBytes, policy] = await Promise.all([
      readFile(
        resolve(packageRoot, "evals/subtitle-translation/manifest.json"),
      ),
      readFile(
        resolve(packageRoot, "evals/subtitle-translation/corpus.lock.json"),
      ),
      loadPackagedSubtitleEvalPolicy(),
    ])

    expect(policy.manifestDigest).toBe(sha256(manifestBytes))
    expect(policy.lockDigest).toBe(sha256(lockBytes))
  })

  it("pins the production subtitle workflow bytes behind the allowlisted digest", async () => {
    const repositoryRoot = resolve(
      dirname(fileURLToPath(import.meta.url)),
      "../../../../..",
    )
    const policyFiles = [
      "apps/mastra/src/services/subtitle-enrichment/chunker.ts",
      "apps/mastra/src/services/subtitle-enrichment/language-config.ts",
      "apps/mastra/src/services/subtitle-enrichment/openrouter.ts",
      "apps/mastra/src/services/subtitle-enrichment/translator.ts",
      "apps/mastra/src/services/subtitle-enrichment/retimer.ts",
      "apps/mastra/src/services/subtitle-enrichment/scripture-context.ts",
      "apps/mastra/src/services/subtitle-enrichment/scripture-validation.ts",
      "apps/mastra/src/services/subtitle-enrichment/types.ts",
      "apps/mastra/src/services/subtitle-enrichment/vtt.ts",
      "apps/mastra/src/services/subtitle-enrichment/run.ts",
      "apps/mastra/src/evals/subtitle-translation/cloud-runner.ts",
      "apps/mastra/src/evals/subtitle-translation/metrics.ts",
      "apps/mastra/src/evals/subtitle-translation/review-evidence.ts",
      "apps/mastra/src/evals/subtitle-translation/runner.ts",
      "apps/mastra/src/evals/subtitle-translation/types.ts",
      "apps/mastra/src/evals/subtitle-translation/vtt.ts",
    ] as const
    expect(SUBTITLE_EVAL_WORKFLOW_POLICY_FILES).toEqual(policyFiles)
    const parts = await Promise.all(
      policyFiles.map(
        async (path) =>
          `${path}:${sha256(await readFile(resolve(repositoryRoot, path)))}`,
      ),
    )

    expect(sha256(parts.join("\n"))).toBe(SUBTITLE_EVAL_WORKFLOW_POLICY_DIGEST)
  })

  it("verifies all frozen identity before invoking the paid execution seam", async () => {
    const executeCell = vi.fn(async () => executedCell())
    const result = await runCloudSubtitleEvalCell(request(), {
      policy: fixturePolicy(),
      executeCell,
      buildIdentity: {
        codeRevision: "1".repeat(40),
        buildId: "deployment-fixture",
      },
    })

    expect(result.ok).toBe(true)
    expect(executeCell).toHaveBeenCalledTimes(1)
    if (!result.ok) throw new Error("expected successful cell")
    expect(result.identityAttestation).toMatchObject({
      cellId: "cell-1",
      caseId: "sample",
      manifestDigest: "a".repeat(64),
      lockDigest: "b".repeat(64),
      targetLanguage: "es",
      sourceSha256: sha256(sourceVtt),
      referenceSha256: sha256(referenceVtt),
    })
    expect(result.artifacts.candidateVtt).toMatchObject({
      sha256: sha256(candidateVtt),
      byteLength: new TextEncoder().encode(candidateVtt).byteLength,
      mediaType: "text/vtt",
      body: candidateVtt,
    })
    expect(result.artifacts.reviewEvidence.sha256).toMatch(/^[a-f0-9]{64}$/)
    expect(result.identityAttestation).not.toHaveProperty("targetLanguageId")
    expect(result.identityAttestation).not.toHaveProperty("targetLanguageSlug")
    expect(result.build).toEqual({
      codeRevision: "1".repeat(40),
      buildId: "deployment-fixture",
    })
    expect(result.determinism).toEqual({
      temperature: 0,
      providerSeed: null,
      concurrency: 1,
    })
    expect(result.policy.workflowPolicyFiles).toEqual(
      SUBTITLE_EVAL_WORKFLOW_POLICY_FILES,
    )
    expect(result.providerCalls).toEqual([
      expect.objectContaining({ providerResponseId: "generation-1" }),
    ])
    expect(result.reviewEvidence.segments).toHaveLength(1)
    expect(sha256(result.artifacts.reviewEvidence.body)).toBe(
      result.artifacts.reviewEvidence.sha256,
    )
    expect(JSON.stringify(result)).not.toContain("openrouter-secret")
  })

  it.each([
    [
      "source bytes",
      () => ({ source: { ...request().source, body: `${sourceVtt}drift` } }),
    ],
    [
      "reference digest",
      () => ({ reference: { ...request().reference, sha256: "f".repeat(64) } }),
    ],
    ["case", () => ({ caseId: "unknown" })],
    ["language", () => ({ targetLanguage: "fr" })],
    ["model", () => ({ model: "unapproved/model" })],
    ["provider", () => ({ provider: "other" })],
    ["prompt policy", () => ({ promptPolicyId: "other-policy" })],
    ["workflow policy", () => ({ workflowPolicyDigest: "f".repeat(64) })],
    ["timeout", () => ({ timeoutMs: 59_999 })],
    ["concurrency", () => ({ concurrency: 2 })],
  ])(
    "rejects drifted or unbounded %s before execution",
    async (_label, patch) => {
      const executeCell = vi.fn(async () => executedCell())
      const result = await runCloudSubtitleEvalCell(
        deepMerge(request(), patch()) as unknown,
        { policy: fixturePolicy(), executeCell },
      )

      expect(result).toMatchObject({
        ok: false,
        failureClass: "deterministic",
        retryable: false,
      })
      expect(executeCell).not.toHaveBeenCalled()
    },
  )

  it("rejects caller-asserted Admin language identities", async () => {
    const executeCell = vi.fn(async () => executedCell())
    const result = await runCloudSubtitleEvalCell(
      {
        ...request(),
        targetLanguageId: "language-admin-es",
        targetLanguageSlug: "spanish",
      },
      { policy: fixturePolicy(), executeCell },
    )

    expect(result).toMatchObject({ ok: false, reason: "invalid_input" })
    expect(executeCell).not.toHaveBeenCalled()
  })

  it("returns a strict retryable provider failure without artifacts", async () => {
    const result = await runCloudSubtitleEvalCell(request(), {
      policy: fixturePolicy(),
      executeCell: async () => {
        const error = new Error("provider body must stay private")
        Object.assign(error, {
          reason: "provider_failed",
          retryable: true,
        })
        throw error
      },
    })

    expect(result).toEqual({
      ok: false,
      cellId: "cell-1",
      reason: "provider_failed",
      failureClass: "retryable",
      retryable: true,
      message: "Subtitle provider execution failed.",
      providerCalls: [],
    })
    expect(JSON.stringify(result)).not.toContain("provider body")
    expect(result).not.toHaveProperty("artifacts")
  })

  it("emits captured provider calls when paid execution fails", async () => {
    const result = await runCloudSubtitleEvalCell(request(), {
      policy: fixturePolicy(),
      executeCell: async () => {
        const error = Object.assign(new Error("private provider body"), {
          reason: "provider_failed",
          retryable: true,
          subtitleEvalProviderCalls: [providerCall],
        })
        throw error
      },
    })

    expect(result).toMatchObject({
      ok: false,
      reason: "provider_failed",
      providerCalls: [
        expect.objectContaining({ providerResponseId: "generation-1" }),
      ],
    })
    expect(JSON.stringify(result)).not.toContain("private provider body")
  })

  it("classifies scoring failures deterministically without artifacts", async () => {
    const result = await runCloudSubtitleEvalCell(request(), {
      policy: fixturePolicy(),
      executeCell: async () => ({
        ...executedCell(),
        candidateVtt: "not-vtt",
      }),
    })

    expect(result).toMatchObject({
      ok: false,
      reason: "scoring_failed",
      failureClass: "deterministic",
      retryable: false,
      providerCalls: [
        expect.objectContaining({ providerResponseId: "generation-1" }),
      ],
    })
    expect(result).not.toHaveProperty("artifacts")
  })
})

function request() {
  return {
    schemaVersion: "subtitle-translation-eval-cell-request/v1" as const,
    cellId: "cell-1",
    caseId: "sample",
    manifestDigest: "a".repeat(64),
    lockDigest: "b".repeat(64),
    targetLanguage: "es",
    provider: "openrouter" as const,
    model: "fixture/model",
    promptPolicyId: SUBTITLE_EVAL_PROMPT_POLICY_ID,
    workflowPolicyDigest: SUBTITLE_EVAL_WORKFLOW_POLICY_DIGEST,
    timeoutMs: 60_000,
    concurrency: 1 as const,
    source: snapshot("source", "en", "529", "source-subtitle", sourceVtt),
    reference: snapshot(
      "reference",
      "es",
      "21028",
      "reference-subtitle",
      referenceVtt,
    ),
  }
}

function snapshot(
  role: "source" | "reference",
  language: string,
  coreLanguageId: string,
  subtitleId: string,
  body: string,
) {
  const digest = sha256(body)
  return {
    body,
    sha256: digest,
    rawSha256: role === "source" ? "c".repeat(64) : "d".repeat(64),
    clippedSha256: digest,
    byteLength: new TextEncoder().encode(body).byteLength,
    mediaType: "text/vtt" as const,
    track: {
      role,
      language,
      coreLanguageId,
      subtitleId,
      videoId: "video-1",
      edition: "base",
      coreVideoEditionId: "edition-1",
      cueCount: role === "source" ? 2 : 1,
    },
  }
}

function fixturePolicy(): SubtitleEvalCloudPolicy {
  const manifest: SubtitleEvalManifest = {
    schemaVersion: "subtitle-translation-eval/v1",
    referenceAuthority: "provisional",
    referenceNotes: "Fixture.",
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
  }
  const lock: SubtitleEvalCorpusLock = {
    schemaVersion: "subtitle-translation-eval-corpus-lock/v1",
    manifestSha256: "a".repeat(64),
    resolvedAt: "2026-08-20T00:00:00.000Z",
    tracks: [
      {
        caseId: "sample",
        role: "source",
        language: "en",
        coreLanguageId: "529",
        subtitleId: "source-subtitle",
        videoId: "video-1",
        edition: "base",
        coreVideoEditionId: "edition-1",
        primary: true,
        sourceUrl: "https://api-media-core.jesusfilm.org/source.vtt",
        sourceSha256: "c".repeat(64),
        clippedSha256: sha256(sourceVtt),
        cueCount: 2,
        relativePath: "sample/en.vtt",
      },
      {
        caseId: "sample",
        role: "reference",
        language: "es",
        coreLanguageId: "21028",
        subtitleId: "reference-subtitle",
        videoId: "video-1",
        edition: "base",
        coreVideoEditionId: "edition-1",
        primary: false,
        sourceUrl: "https://api-media-core.jesusfilm.org/reference.vtt",
        sourceSha256: "d".repeat(64),
        clippedSha256: sha256(referenceVtt),
        cueCount: 1,
        relativePath: "sample/es.vtt",
      },
    ],
  }
  return {
    manifest,
    manifestDigest: "a".repeat(64),
    lock,
    lockDigest: "b".repeat(64),
    allowedModels: ["fixture/model"],
    allowedPromptPolicyIds: [SUBTITLE_EVAL_PROMPT_POLICY_ID],
    allowedWorkflowPolicyDigests: [SUBTITLE_EVAL_WORKFLOW_POLICY_DIGEST],
  }
}

function executedCell() {
  return {
    candidateVtt,
    providerCalls: [providerCall],
    usage: {
      promptTokens: 10,
      completionTokens: 5,
      totalTokens: 15,
      retimeFallbackCount: 0,
      operations: {
        scriptureDetection: operationUsage(1, 0, 1),
        translation: operationUsage(4, 2, 6),
        retiming: operationUsage(3, 2, 5),
        scriptureValidation: operationUsage(2, 1, 3),
      },
      coverage: {
        status: "complete" as const,
        missingOperations: [],
      },
    },
  }
}

const providerCall = {
  callSequence: 1,
  operation: "translation" as const,
  chunkIndex: 0,
  operationAttempt: 0,
  status: "SUCCEEDED" as const,
  requestDigest: "e".repeat(64),
  providerRequestId: null,
  providerResponseId: "generation-1",
  requestedModel: "fixture/model",
  resolvedModel: "provider/resolved-model",
  usage: { promptTokens: 4, completionTokens: 2, totalTokens: 6 },
}

function operationUsage(
  promptTokens: number,
  completionTokens: number,
  totalTokens: number,
) {
  return {
    promptTokens,
    completionTokens,
    totalTokens,
    providerResponseCount: 1,
    unaccountedResponseCount: 0,
    accounting: "instrumented" as const,
  }
}

function deepMerge(
  base: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries({ ...base, ...patch }).map(([key, value]) => [
      key,
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      base[key] &&
      typeof base[key] === "object" &&
      !Array.isArray(base[key])
        ? deepMerge(
            base[key] as Record<string, unknown>,
            value as Record<string, unknown>,
          )
        : value,
    ]),
  )
}
