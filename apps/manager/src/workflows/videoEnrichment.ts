// NOTE: The "use workflow" and "use step" directives require the workflow SDK's
// build plugin to be active for durable execution. Without the plugin configured
// in next.config.ts, these directives are inert and the workflow runs as a plain
// async function (no durability, no step-level retries, no checkpointing).
// To enable: configure the workflow plugin and set WORKFLOW_API_KEY in env.
// See: https://useworkflow.dev/
//
// Video enrichment workflow — orchestrates the full pipeline for a single video asset.
// Steps: transcribe -> translate -> chapters -> metadata -> embeddings
//
// Uses the `workflow` package ("use workflow" / "use step" directives)
// for durable execution. Each step is idempotent.

import { createHash } from "node:crypto"
import { buildDownloadableArtifactManifest } from "@/lib/job-artifacts"
import { buildEmbeddingSyncArtifact } from "@/lib/embedding-sync-report"
import {
  mergeArtifactEntries,
  mergeJobArtifacts,
  updateJob,
  updateStepStatus,
} from "@/lib/state"
import type { WorkflowStepName } from "@/types/job"
import type {
  EmbeddingSyncReport,
  JobArtifactManifest,
  JobStepDetails,
  TranslationLanguageResult,
} from "@/types/job"
import type { EmbeddingTranscriptInput } from "@/services/embeddings"
import type { GenerateChaptersInput } from "@/services/chapters"
import type { VideoMetadata } from "@/services/metadata"
import type { LanguageResult } from "@/services/subtitleTranslation/types"

export type VideoEnrichmentInput = {
  jobId: string
  assetId: string
  muxAssetId: string
  language?: string
  translateTo?: string[]
  runSceneAnalysis?: boolean
  videoLabel?: string
  bibleVerses?: string[]
  initialArtifacts?: JobArtifactManifest
  videoDocumentId?: string
}

export type VideoEnrichmentOutput = {
  assetId: string
  transcript: string
  language: string
  chapters: { title: string; startSeconds: number }[]
  tags: string[]
}

async function markStepRunning(jobId: string, step: WorkflowStepName) {
  await updateStepStatus(jobId, step, "running")
  await updateJob(jobId, { status: "running", currentStep: step })
}

async function markStepComplete(
  jobId: string,
  step: WorkflowStepName,
  details?: JobStepDetails,
) {
  if (details === undefined) {
    await updateStepStatus(jobId, step, "completed")
    return
  }

  await updateStepStatus(jobId, step, "completed", undefined, details)
}

async function markStepFailed(
  jobId: string,
  step: WorkflowStepName,
  error: string,
) {
  await updateStepStatus(jobId, step, "failed", error)
}

async function persistArtifacts(
  jobId: string,
  artifacts: JobArtifactManifest,
): Promise<void> {
  const updated = await updateJob(jobId, { artifacts })
  if (!updated) {
    throw new Error(`Failed to persist artifact manifest for job ${jobId}`)
  }
}

async function persistMergedArtifacts(
  jobId: string,
  artifacts: JobArtifactManifest,
): Promise<void> {
  if (Object.keys(artifacts).length === 0) {
    return
  }

  const updated = await mergeJobArtifacts(jobId, artifacts)
  if (!updated) {
    throw new Error(`Failed to persist artifact manifest for job ${jobId}`)
  }
}

function getTranslationArtifactManifest(
  results: LanguageResult[],
): JobArtifactManifest {
  return buildDownloadableArtifactManifest(
    results.flatMap((result) =>
      result.status === "completed"
        ? [`subtitles-${result.lang}`, `translation-${result.lang}`]
        : [],
    ),
  )
}

function getTranslationStepDetails(
  results: LanguageResult[],
): JobStepDetails | undefined {
  if (results.length === 0) {
    return undefined
  }

  const languageResults: TranslationLanguageResult[] = results.map(
    (result) => ({
      lang: result.lang,
      status: result.status,
      error: result.error,
    }),
  )

  return { languageResults }
}

function buildGeneratedEmbeddingContentFingerprint(
  model: string,
  chunks: Array<{ text: string }>,
): string {
  return `sha256:${createHash("sha256")
    .update(
      JSON.stringify({
        model,
        chunks: chunks.map((chunk, index) => ({
          index,
          text: chunk.text,
        })),
      }),
    )
    .digest("hex")}`
}

function buildFallbackEmbeddingSyncReport(
  result: Awaited<ReturnType<typeof stepEmbeddings>>,
  videoDocumentId: string | undefined,
  reason: string,
): EmbeddingSyncReport {
  return {
    domain: "embeddings",
    status: "failed",
    ...(videoDocumentId ? { videoDocumentId } : {}),
    reason,
    generated: {
      model: result.model,
      dimensions: result.dimensions,
      chunkCount: result.chunks.length,
      contentFingerprint: buildGeneratedEmbeddingContentFingerprint(
        result.model,
        result.chunks,
      ),
      hasMetadataEmbedding: result.metadataEmbedding != null,
      ...(typeof result.metadata.generatedAt === "string"
        ? { generatedAt: result.metadata.generatedAt }
        : {}),
    },
  }
}

export async function runVideoEnrichment(
  input: VideoEnrichmentInput,
): Promise<VideoEnrichmentOutput> {
  "use workflow"

  const language = input.language ?? "auto"
  let artifactManifest = input.initialArtifacts ?? {}

  console.log(
    JSON.stringify({
      event: "workflow_start",
      jobId: input.jobId,
      assetId: input.assetId,
    }),
  )

  await updateJob(input.jobId, {
    status: "running",
    startedAt: new Date().toISOString(),
  })

  try {
    // Step 1: Transcription
    await markStepRunning(input.jobId, "transcription")
    let transcription: Awaited<ReturnType<typeof stepTranscribe>>
    try {
      transcription = await stepTranscribe(
        input.assetId,
        input.muxAssetId,
        language,
      )
      artifactManifest = mergeArtifactEntries(
        artifactManifest,
        buildDownloadableArtifactManifest(transcription.artifactKeys),
      )
      await persistArtifacts(input.jobId, artifactManifest)
      await markStepComplete(input.jobId, "transcription")
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error"
      await markStepFailed(input.jobId, "transcription", msg)
      throw err
    }

    // Steps 2-5: Translation, chapters, metadata, embeddings
    // Translation and chapters still depend only on transcription.
    // Embeddings can now include metadata context when available, but must
    // still fall back to transcript-only output if metadata fails.
    const targets = input.translateTo ?? []
    const parallelSteps: WorkflowStepName[] = [
      "translation",
      "chapters",
      "metadata",
      "embeddings",
    ]
    for (const step of parallelSteps) {
      await markStepRunning(input.jobId, step)
    }

    async function runParallelStep<T>(
      stepName: WorkflowStepName,
      fn: () => Promise<T>,
      getArtifacts?: (result: T) => JobArtifactManifest,
      getDetails?: (result: T) => JobStepDetails | undefined,
    ): Promise<{ result: T }> {
      try {
        const result = await fn()
        const artifacts = getArtifacts?.(result) ?? {}
        const details = getDetails?.(result)
        await persistMergedArtifacts(input.jobId, artifacts)
        await markStepComplete(input.jobId, stepName, details)
        return {
          result,
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error"
        await markStepFailed(input.jobId, stepName, msg)
        throw err
      }
    }

    const translationPromise = runParallelStep(
      "translation",
      () => stepSubtitleTranslation(input.assetId, language, targets),
      getTranslationArtifactManifest,
      getTranslationStepDetails,
    )

    const chaptersPromise = runParallelStep(
      "chapters",
      () =>
        stepChapters(input.assetId, {
          transcriptText: transcription.text,
          segments: transcription.segments,
          language: transcription.language,
        }),
      (result) => buildDownloadableArtifactManifest(result.artifactKeys),
    )

    const metadataPromise = runParallelStep(
      "metadata",
      () =>
        stepMetadata(input.assetId, transcription.text, transcription.language),
      (result) => buildDownloadableArtifactManifest(result.artifactKeys),
    )

    const embeddingsPromise = (async () => {
      try {
        const metadata = await metadataPromise
          .then(({ result }) => ({
            title: result.title,
            description: result.description,
            topics: result.topics,
            speakers: result.speakers,
            tags: result.tags,
            language: result.language,
          }))
          .catch(() => null)

        const result = await stepEmbeddings(
          input.assetId,
          transcription,
          metadata,
        )
        await persistMergedArtifacts(
          input.jobId,
          buildDownloadableArtifactManifest(result.artifactKeys),
        )

        let syncReport: EmbeddingSyncReport
        try {
          const { syncEmbeddingArtifact } =
            await import("@/services/embeddingSync")
          syncReport = await syncEmbeddingArtifact({
            assetId: input.assetId,
            videoDocumentId: input.videoDocumentId,
          })
        } catch (error) {
          syncReport = buildFallbackEmbeddingSyncReport(
            result,
            input.videoDocumentId,
            error instanceof Error ? error.message : "embedding_sync_failed",
          )
        }

        await persistMergedArtifacts(
          input.jobId,
          buildEmbeddingSyncArtifact(syncReport),
        )
        await markStepComplete(input.jobId, "embeddings")
        return { result, syncReport }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error"
        await markStepFailed(input.jobId, "embeddings", msg)
        throw err
      }
    })()

    const [
      translationResult,
      chaptersResult,
      metadataResult,
      embeddingsResult,
    ] = await Promise.allSettled([
      translationPromise,
      chaptersPromise,
      metadataPromise,
      embeddingsPromise,
    ])

    if (translationResult.status === "rejected") {
      throw translationResult.reason
    }
    if (chaptersResult.status === "rejected") {
      throw chaptersResult.reason
    }
    if (metadataResult.status === "rejected") {
      throw metadataResult.reason
    }
    if (embeddingsResult.status === "rejected") {
      throw embeddingsResult.reason
    }

    // Optional: Scene analysis (chapters → scene boundaries → OpenRouter + stills)
    // Uses the transcript already produced by enrichment, not a VTT fetch.
    // Error-isolated: scene analysis failure does not block core enrichment.
    if (input.runSceneAnalysis) {
      try {
        const { extractAndStoreSceneBoundaries } =
          await import("@/services/sceneBoundaries")
        const { analyzeAllScenes } = await import("@/services/sceneAnalysis")
        const { getMuxAsset } = await import("@/services/mux")

        const boundaries = await extractAndStoreSceneBoundaries(
          input.assetId,
          chaptersResult.value.result.chapters,
          transcription.text,
        )

        const muxAsset = await getMuxAsset(input.muxAssetId)
        await analyzeAllScenes(
          input.assetId,
          muxAsset.playbackId,
          boundaries.scenes,
          {
            videoLabel: input.videoLabel ?? "unknown",
            bibleVerses: input.bibleVerses,
          },
        )
      } catch (sceneError) {
        console.error(
          JSON.stringify({
            event: "scene_analysis_failed_in_enrichment",
            jobId: input.jobId,
            error:
              sceneError instanceof Error
                ? sceneError.message
                : "Unknown error",
          }),
        )
      }
    }

    // Mark job complete
    await updateJob(input.jobId, {
      status: "completed",
      currentStep: undefined,
      completedAt: new Date().toISOString(),
    })

    console.log(
      JSON.stringify({
        event: "workflow_complete",
        jobId: input.jobId,
        assetId: input.assetId,
      }),
    )

    return {
      assetId: input.assetId,
      transcript: transcription.text,
      language: transcription.language,
      chapters: chaptersResult.value.result.chapters.map((c) => ({
        title: c.title,
        startSeconds: c.startSeconds,
      })),
      tags: metadataResult.value.result.tags,
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error"
    console.log(
      JSON.stringify({
        event: "workflow_error",
        jobId: input.jobId,
        error: message,
      }),
    )

    // Individual parallel steps mark themselves as failed via runParallelStep.
    // Just mark the overall job as failed here.
    await updateJob(input.jobId, {
      status: "failed",
      currentStep: undefined,
    })
    throw error
  }
}

async function stepTranscribe(
  assetId: string,
  muxAssetId: string,
  language: string,
) {
  "use step"
  const { transcribe } = await import("@/services/transcription")
  return transcribe(assetId, muxAssetId, language)
}

async function stepSubtitleTranslation(
  assetId: string,
  sourceLanguage: string,
  targetLanguages: string[],
) {
  "use step"
  const { translateSubtitles } = await import("@/services/subtitleTranslation")
  return translateSubtitles({ assetId, sourceLanguage, targetLanguages })
}

async function stepChapters(assetId: string, input: GenerateChaptersInput) {
  "use step"
  const { generateChapters } = await import("@/services/chapters")
  return generateChapters(assetId, input)
}

async function stepMetadata(
  assetId: string,
  transcript: string,
  language: string,
) {
  "use step"
  const { extractMetadata } = await import("@/services/metadata")
  return extractMetadata(assetId, transcript, language)
}

async function stepEmbeddings(
  assetId: string,
  transcript: EmbeddingTranscriptInput,
  metadata: VideoMetadata | null,
) {
  "use step"
  const { generateEmbeddings } = await import("@/services/embeddings")
  return generateEmbeddings(assetId, transcript, { metadata })
}
