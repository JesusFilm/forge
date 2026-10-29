import { z } from "zod"
import { enrichmentSourceReuse } from "../../server/forge-video-enrichment-contract"
import { executionDigest } from "../../server/enrichment-input-digest"
import type {
  ForgeVideoEnrichmentInput,
  ForgeVideoEnrichmentOutput,
} from "../../server/forge-video-enrichment-contract"
import {
  executeManagerEnrichmentOperation,
  ManagerEnrichmentExecutionError,
  type MastraExecutionStage,
} from "../manager-enrichment-execution-client"
import {
  sendManagerEnrichmentCallback,
  ManagerEnrichmentCallbackError,
  type ManagerEnrichmentCallback,
} from "../manager-enrichment-callback-client"
import { CallbackStepDetailsSchema } from "../manager-enrichment-callback-contract"
import { SubtitleSourceError } from "../subtitle-enrichment/source"
import { buildUnavailableTranscriptScriptureCorrectionResult } from "../subtitle-enrichment/transcript-correction"
import { readSubtitleArtifact } from "../subtitle-enrichment/storage"
import type { SubtitleLanguageResult } from "../subtitle-enrichment/types"
import { videoEnrichmentRuntime, type VideoEnrichmentRuntime } from "./runtime"
import { trackEnrichmentSpend, EnrichmentSettledError } from "./provider-spend"

type Step = ManagerEnrichmentCallback["step"]
type Details = z.infer<typeof CallbackStepDetailsSchema>
type FinishedCallback = Extract<
  ManagerEnrichmentCallback,
  { status: "completed" }
>
export type VideoEnrichmentGraphDeps = {
  runtime: VideoEnrichmentRuntime
  execute: typeof executeManagerEnrichmentOperation
  callback: typeof sendManagerEnrichmentCallback
}
export class VideoEnrichmentGraphError extends Error {
  constructor(
    message: string,
    readonly callbackData: Partial<FinishedCallback> = {},
  ) {
    super(message)
    this.name = "VideoEnrichmentGraphError"
  }
}
const message = (error: unknown) =>
  (error instanceof Error
    ? error.message
    : "Enrichment execution failed"
  ).slice(0, 1000)
const receipt = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("claimed"),
    claimToken: z.string().min(1).max(128),
  }),
  z.object({
    status: z.literal("replayed"),
    result: z.object({ status: z.enum(["completed", "failed"]) }),
  }),
])
const correctionApplication = z.object({
  artifactKeys: z.array(z.string()).max(5),
  summary: CallbackStepDetailsSchema.shape.transcriptCorrection.unwrap(),
  changed: z.boolean(),
})
const muxResult = z.object({
  report: z.object({
    comparisons: z.array(
      z.object({ status: z.string(), explanation: z.string() }),
    ),
  }),
})

function translationDetails(
  languages: SubtitleLanguageResult[],
  runId: string,
): Details {
  const results = languages.flatMap((result) =>
    result.validationSummary
      ? [{ lang: result.lang, ...result.validationSummary }]
      : [],
  )
  const rank = { pass: 0, unavailable: 1, warning: 2, needs_review: 3 }
  return {
    mastra: {
      runId,
      status: "completed",
      languages: languages.map((result) => result.lang),
    },
    ...(results.length
      ? {
          subtitleValidation: {
            highestVerdict: results.reduce<keyof typeof rank>(
              (highest, result) =>
                rank[result.verdict] > rank[highest] ? result.verdict : highest,
              "pass",
            ),
            languagesChecked: results.length,
            modelOnlyLanguages: results
              .filter((r) => r.basis === "model_knowledge")
              .map((r) => r.lang),
            unavailableLanguages: results
              .filter(
                (r) => r.basis === "unavailable" || r.verdict === "unavailable",
              )
              .map((r) => r.lang),
            warningCount: results.reduce((n, r) => n + r.warningCount, 0),
            needsReviewCount: results.reduce(
              (n, r) => n + r.needsReviewCount,
              0,
            ),
            results,
          },
        }
      : {}),
  }
}

/** Actual runtime graph. Ledger claims, not process memory, authorize every stage. */
export async function runVideoEnrichmentGraph(
  input: ForgeVideoEnrichmentInput,
  runId: string,
  dependencies: Partial<VideoEnrichmentGraphDeps> = {},
): Promise<ForgeVideoEnrichmentOutput> {
  const { runtime, execute, callback } = {
    runtime: videoEnrichmentRuntime,
    execute: executeManagerEnrichmentOperation,
    callback: sendManagerEnrichmentCallback,
    ...dependencies,
  }
  const fence = {
    jobId: input.jobId,
    runId,
    inputDigest: executionDigest(input),
  }
  const sequences = new Map<Step, number>()
  let ownershipLost = false
  let ambiguous = false
  let failedStep: Step = "transcription"
  const emit = async (
    step: Step,
    update: Omit<
      ManagerEnrichmentCallback,
      "jobId" | "engine" | "runId" | "sequence" | "step"
    > &
      Record<string, unknown>,
  ) => {
    if (ownershipLost) throw new VideoEnrichmentGraphError("Run ownership lost")
    const sequence = (sequences.get(step) ?? 0) + 1
    sequences.set(step, sequence)
    try {
      await callback({
        jobId: input.jobId,
        engine: "mastra",
        runId,
        sequence,
        step,
        ...update,
      } as ManagerEnrichmentCallback)
    } catch (error) {
      ownershipLost = true
      throw error
    }
  }
  const manager = async (
    operation: Parameters<typeof execute>[0]["operation"],
  ) => {
    try {
      return await execute({ ...fence, operation })
    } catch (error) {
      if (
        error instanceof ManagerEnrichmentExecutionError &&
        error.status === 409
      )
        ownershipLost = true
      else ambiguous = true
      throw error
    }
  }
  const spend = async <T>(
    stage: MastraExecutionStage,
    stageInput: unknown,
    work: () => Promise<T>,
  ): Promise<T> => {
    if (ownershipLost) throw new VideoEnrichmentGraphError("Run ownership lost")
    const stageDigest = executionDigest(stageInput)
    let claim: z.infer<typeof receipt>
    try {
      claim = receipt.parse(
        await manager({ kind: "mastra-stage-claim", stage, stageDigest }),
      )
    } catch (error) {
      if (!ownershipLost) ambiguous = true
      throw error
    }
    if (claim.status !== "claimed")
      throw new VideoEnrichmentGraphError(
        `Stage ${stage} already consumed; verify persisted artifacts before recovery`,
      )
    let result: T
    let settledError: unknown
    try {
      if (ownershipLost) {
        ambiguous = true
        throw new VideoEnrichmentGraphError(
          "Run ownership lost before provider call",
        )
      }
      result = await trackEnrichmentSpend(work)
    } catch (error) {
      if (
        error instanceof EnrichmentSettledError ||
        (error instanceof SubtitleSourceError && !error.retryable)
      )
        settledError = error
      else {
        ambiguous = true
        throw error
      }
    }
    let completion: z.infer<typeof receipt>
    try {
      completion = receipt.parse(
        await manager({
          kind: "mastra-stage-complete",
          stage,
          stageDigest,
          claimToken: claim.claimToken,
          result: { status: settledError ? "failed" : "completed" },
        }),
      )
    } catch (error) {
      ambiguous = true
      throw error
    }
    if (
      completion.status !== "replayed" ||
      completion.result.status !== (settledError ? "failed" : "completed")
    ) {
      ambiguous = true
      throw new VideoEnrichmentGraphError("Stage completion was not persisted")
    }
    if (settledError) throw settledError
    return result!
  }
  const step = async <T>(
    name: Step,
    work: () => Promise<T>,
    finish: (result: T) => Partial<FinishedCallback> = () => ({}),
  ) => {
    await emit(name, { status: "running" })
    try {
      const result = await work()
      await emit(name, { status: "completed", ...finish(result) })
      return result
    } catch (error) {
      failedStep = name
      if (!ownershipLost)
        await emit(name, {
          status: "failed",
          error: message(error),
          ...(error instanceof VideoEnrichmentGraphError
            ? error.callbackData
            : {}),
        })
      throw error
    }
  }
  try {
    // Unsupported requests fail before any spend; never silently replace ElevenLabs.
    if (input.requestedTranscriptionProvider === "elevenlabs")
      throw new VideoEnrichmentGraphError(
        "Explicit ElevenLabs transcription requires the Manager legacy engine",
      )
    if (!input.language || input.language === "auto")
      throw new VideoEnrichmentGraphError(
        "Mastra enrichment requires an explicit source language",
      )
    if (input.runAudioCleanup)
      await step(
        "audio_cleanup",
        async () => {
          const result = z
            .object({
              artifactKeys: z.array(z.string()).max(10),
              ok: z.boolean().optional(),
              error: z.string().max(1000).optional(),
            })
            .parse(await manager({ kind: "audio-cleanup" }))
          if (result.ok === false)
            throw new EnrichmentSettledError(
              result.error ?? "Audio cleanup failed",
            )
          return result
        },
        (result) => ({ artifactsDelta: result.artifactKeys }),
      )
    else await emit("audio_cleanup", { status: "skipped" })

    const sourceReuse = enrichmentSourceReuse(input)
    const sourceInput = {
      assetId: input.assetId,
      sourceLanguage: input.language,
      source:
        sourceReuse === "transcript"
          ? { kind: "transcript_artifact" as const }
          : sourceReuse === "subtitles"
            ? { kind: "subtitle_artifact" as const }
            : { kind: "mux" as const, muxAssetId: input.muxAssetId },
    }
    let transcript = await step(
      "transcription",
      () => spend("source", sourceInput, () => runtime.source(sourceInput)),
      () => ({ artifactsDelta: ["transcript", "subtitles"] }),
    )
    const translationContext = {
      ...(input.videoTitle?.trim()
        ? { videoTitle: input.videoTitle.trim() }
        : {}),
      ...(input.videoLabel?.trim()
        ? { videoLabel: input.videoLabel.trim() }
        : {}),
      ...(input.bibleVerses?.length
        ? {
            bibleReferences: input.bibleVerses
              .map((s) => s.trim().replace(/\s+/g, " "))
              .filter(
                (s) =>
                  s.length <= 80 &&
                  /^(?:[1-3]\s*)?[A-Za-z][A-Za-z .'-]{1,40}\s+\d{1,3}(?::\d{1,3}(?:[-–]\d{1,3})?)?(?:\s*[-–]\s*\d{1,3}(?::\d{1,3}(?:[-–]\d{1,3})?)?)?$/.test(
                    s,
                  ),
              )
              .filter((s, index, values) => values.indexOf(s) === index)
              .slice(0, 20),
          }
        : {}),
    }
    const correctionInput = {
      assetId: input.assetId,
      sourceLanguage: transcript.language,
      segments: transcript.segments,
      translationContext,
    }
    await step(
      "structured_transcript",
      async () => {
        const judgment = await spend("correction", correctionInput, () =>
          runtime.correction(correctionInput, { runId: `${runId}-correction` }),
        )
        const correction = judgment.ok
          ? judgment.correction
          : buildUnavailableTranscriptScriptureCorrectionResult({
              scriptureContext: {
                contentDomain: "christian_general",
                confidence: 0,
                likelyBibleReferences: [],
              },
              unavailableReason: judgment.reason,
            })
        const application = correctionApplication.parse(
          await manager({
            kind: "apply-transcript-corrections",
            correction,
          }),
        )
        const corrected = await runtime.readCorrected(input.assetId)
        transcript = { ...transcript, ...corrected }
        return { application, judgment }
      },
      ({ application, judgment }) => ({
        artifactsDelta: application.artifactKeys,
        details: {
          mastra: {
            runId: judgment.mastraRunId,
            ...(judgment.ok
              ? { status: judgment.correction.status }
              : { reason: judgment.reason, retryable: judgment.retryable }),
          },
          transcriptCorrection: application.summary,
        },
      }),
    )

    const translationInput = {
      assetId: input.assetId,
      sourceLanguage: transcript.language,
      targetLanguages: input.translateTo ?? [],
      translationContext,
    }
    // The leaf owns language concurrency/chunk sequencing. Do not add language fan-out.
    const settled = await Promise.allSettled([
      step(
        "translation",
        async () => {
          const result = await spend(
            "translation",
            { input: translationInput, transcript },
            () =>
              runtime.translation(translationInput, {
                runId: `${runId}-translation`,
                deps: {
                  readArtifact: async (assetId, type, ext) =>
                    assetId === input.assetId &&
                    type === "transcript" &&
                    ext === "json"
                      ? Buffer.from(JSON.stringify(transcript))
                      : readSubtitleArtifact(assetId, type, ext),
                },
              }),
          )
          if (!result.ok)
            throw new VideoEnrichmentGraphError(
              `Subtitle enrichment failed: ${result.reason}`,
              {
                languageResults: (result.languages ?? []).map((r) => ({
                  lang: r.lang,
                  status: r.status,
                  ...(r.error ? { error: r.error.slice(0, 240) } : {}),
                })),
                details: translationDetails(
                  result.languages ?? [],
                  result.mastraRunId,
                ),
              },
            )
          return result
        },
        (result) => ({
          languageResults: result.languages.map((r) => ({
            lang: r.lang,
            status: r.status,
            ...(r.error ? { error: r.error.slice(0, 240) } : {}),
          })),
          artifactsDelta: result.languages.flatMap((r) =>
            r.status === "completed"
              ? [
                  `subtitles-${r.lang}`,
                  `translation-${r.lang}`,
                  ...(r.artifactKeys?.validation
                    ? [`subtitle-validation-${r.lang}`]
                    : []),
                ]
              : [],
          ),
          details: translationDetails(result.languages, result.mastraRunId),
        }),
      ),
      step(
        "chapters",
        () => {
          const chapterInput = {
            transcriptText: transcript.text,
            segments: transcript.segments,
            language: transcript.language,
          }
          return spend(
            "chapters",
            { assetId: input.assetId, ...chapterInput },
            () => runtime.chapters(input.assetId, chapterInput),
          )
        },
        (result) => ({ artifactsDelta: result.artifactKeys }),
      ),
      step(
        "metadata",
        () =>
          spend(
            "metadata",
            {
              assetId: input.assetId,
              text: transcript.text,
              language: transcript.language,
            },
            () =>
              runtime.metadata(
                input.assetId,
                transcript.text,
                transcript.language,
              ),
          ),
        (result) => ({ artifactsDelta: result.artifactKeys }),
      ),
      step(
        "embeddings",
        async () => {
          const embeddingInput = {
            target: {
              external: {
                assetId: input.assetId,
                muxAssetId: input.muxAssetId,
              },
            },
            language: transcript.language,
            transcript: {
              text: transcript.text,
              segments: transcript.segments,
              kind: "manager-transcript",
              provider: sourceInput.source.kind === "mux" ? "mux" : "artifact",
            },
          }
          const result = await spend("embeddings", embeddingInput, async () => {
            const result = await runtime.embeddings(embeddingInput, {
              runId: `${runId}-embeddings`,
            })
            // The existing leaf maps transport failures into values. Conservatively
            // keep these consumed; a resolved failure is not a no-spend receipt.
            if (
              !result.ok &&
              ["provider_failed", "admin_ingest_failed"].includes(result.reason)
            )
              throw new VideoEnrichmentGraphError(
                `Ambiguous embeddings: ${result.reason}`,
              )
            return result
          })
          if (!result.ok)
            throw new VideoEnrichmentGraphError(
              `Transcript embeddings failed: ${result.reason}`,
            )
          return result
        },
        (result) => ({
          details: {
            mastra: {
              runId: result.mastraRunId,
              status: result.status,
              provider: result.provider,
              model: result.model,
              chunks: result.chunks,
              totalTokens: result.totalTokens,
              sourceContentHash: result.sourceContentHash,
            },
          },
        }),
      ),
    ])
    const failure = settled.find((result) => result.status === "rejected")
    if (failure?.status === "rejected") throw failure.reason
    const [translation, chapters] = settled
    if (translation.status !== "fulfilled" || chapters.status !== "fulfilled")
      throw new VideoEnrichmentGraphError("Parallel enrichment failed")
    // Tuple inference retains branch outputs for Manager-owned publication.
    const publication = await step("mux_upload", async () => {
      const result = muxResult.parse(
        await manager({
          kind: "mux-publication",
          languageResults: translation.value.languages.map((r) => ({
            lang: r.lang,
            status: r.status,
            ...(r.error ? { error: r.error.slice(0, 240) } : {}),
          })),
        }),
      )
      const failures = result.report.comparisons.filter(
        (c) => c.status === "failed",
      )
      if (failures.length)
        throw new VideoEnrichmentGraphError(
          failures
            .map((c) => c.explanation)
            .join("; ")
            .slice(0, 1000),
        )
      return result
    })
    void publication
    if (input.runSceneAnalysis) {
      try {
        await spend(
          "scene-analysis",
          { input, transcript, chapters: chapters.value.chapters },
          () => runtime.scene(input, transcript, chapters.value.chapters),
        )
      } catch (error) {
        if (ownershipLost || ambiguous) throw error
        // Deterministically settled optional failures do not fail core enrichment.
      }
    }
    await emit("mux_upload", { status: "completed", jobStatus: "completed" })
    return {
      ok: true,
      jobId: input.jobId,
      runId,
      acceptedAt: new Date().toISOString(),
    }
  } catch (error) {
    // In-flight/ambiguous stages fence terminal writes in Admin. Leave the job
    // running for explicit reconciliation; never pretend those claims settled.
    if (
      !ownershipLost &&
      !ambiguous &&
      !(error instanceof ManagerEnrichmentCallbackError)
    ) {
      await emit(failedStep, {
        status: "failed",
        error: message(error),
        jobStatus: "failed",
      })
    }
    throw error
  }
}
