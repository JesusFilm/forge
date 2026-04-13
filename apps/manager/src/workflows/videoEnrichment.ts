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
import { buildSceneEmbeddingSyncArtifact } from "@/lib/scene-embedding-sync-report"
import { getMuxSyncReport, setMuxSyncReport } from "@/lib/mux-sync-report"
import { setTranscriptionRoutingReport } from "@/lib/transcription-routing-report"
import {
  getJob,
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
  MuxSyncReport,
  RequestedTranscriptionProvider,
  TranscriptionRoutingReport,
  TranslationLanguageResult,
} from "@/types/job"
import type { EmbeddingTranscriptInput } from "@/services/embeddings"
import type { GenerateChaptersInput } from "@/services/chapters"
import type { VideoMetadata } from "@/services/metadata"
import type { LanguageResult } from "@/services/subtitleTranslation/types"

function getRoutingReportFromError(error: unknown): JobArtifactManifest | null {
  if (
    typeof error !== "object" ||
    error == null ||
    !("routingReport" in error) ||
    typeof error.routingReport !== "object" ||
    error.routingReport == null
  ) {
    return null
  }

  return setTranscriptionRoutingReport(
    {},
    error.routingReport as TranscriptionRoutingReport,
  )
}

export type VideoEnrichmentInput = {
  jobId: string
  assetId: string
  muxAssetId: string
  playbackId?: string
  language?: string
  translateTo?: string[]
  runSceneAnalysis?: boolean
  runAudioCleanup?: boolean
  videoLabel?: string
  bibleVerses?: string[]
  initialArtifacts?: JobArtifactManifest
  videoDocumentId?: string
  requestedTranscriptionProvider?: RequestedTranscriptionProvider
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

async function markStepSkipped(jobId: string, step: WorkflowStepName) {
  await updateStepStatus(jobId, step, "skipped")
}

function getPersistedAudioCleanupArtifactKeys(error: unknown): string[] {
  if (
    typeof error !== "object" ||
    error == null ||
    !("artifactKeys" in error)
  ) {
    return []
  }

  const artifactKeys = (error as { artifactKeys?: unknown }).artifactKeys
  if (!Array.isArray(artifactKeys)) {
    return []
  }

  return artifactKeys.filter(
    (key): key is string => key === "original-audio" || key === "cleaned-audio",
  )
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
        input.requestedTranscriptionProvider,
        artifactManifest,
      )
      const transcriptionArtifacts = transcription.routingReport
        ? mergeArtifactEntries(
            buildDownloadableArtifactManifest(transcription.artifactKeys),
            setTranscriptionRoutingReport({}, transcription.routingReport),
          )
        : buildDownloadableArtifactManifest(transcription.artifactKeys)
      artifactManifest = mergeArtifactEntries(
        artifactManifest,
        transcriptionArtifacts,
      )
      await persistArtifacts(input.jobId, artifactManifest)
      await markStepComplete(input.jobId, "transcription")
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error"
      const routingArtifacts = getRoutingReportFromError(err)
      if (routingArtifacts) {
        artifactManifest = mergeArtifactEntries(
          artifactManifest,
          routingArtifacts,
        )
        await persistArtifacts(input.jobId, artifactManifest)
      }
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

    async function runAudioCleanupStep(): Promise<void> {
      try {
        await markStepRunning(input.jobId, "audio_cleanup")
        const { runAudioCleanup } = await import("@/services/audioCleanup")
        const { getMuxAsset, getPlaybackUrl } = await import("@/services/mux")
        const playbackId =
          input.playbackId ?? (await getMuxAsset(input.muxAssetId)).playbackId
        const audioCleanupResult = await runAudioCleanup({
          assetId: input.assetId,
          sourceVideoUrl: getPlaybackUrl(playbackId),
        })
        await persistMergedArtifacts(
          input.jobId,
          buildDownloadableArtifactManifest(audioCleanupResult.artifactKeys),
        )
        await markStepComplete(input.jobId, "audio_cleanup")
      } catch (audioError) {
        const audioCleanupArtifactKeys =
          getPersistedAudioCleanupArtifactKeys(audioError)

        try {
          await persistMergedArtifacts(
            input.jobId,
            buildDownloadableArtifactManifest(audioCleanupArtifactKeys),
          )
        } catch (persistError) {
          console.error(
            JSON.stringify({
              event: "audio_cleanup_artifact_manifest_failed",
              jobId: input.jobId,
              error:
                persistError instanceof Error
                  ? persistError.message
                  : "Unknown artifact persistence error",
            }),
          )
        }

        const msg =
          audioError instanceof Error ? audioError.message : "Unknown error"
        try {
          await markStepFailed(input.jobId, "audio_cleanup", msg)
        } catch (statusError) {
          console.error(
            JSON.stringify({
              event: "audio_cleanup_status_update_failed",
              jobId: input.jobId,
              error:
                statusError instanceof Error
                  ? statusError.message
                  : "Unknown status update error",
            }),
          )
        }
        console.error(
          JSON.stringify({
            event: "audio_cleanup_failed_in_enrichment",
            jobId: input.jobId,
            error: msg,
          }),
        )
      }
    }

    const audioCleanupPromise = input.runAudioCleanup
      ? runAudioCleanupStep()
      : undefined

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
      await audioCleanupPromise
      throw translationResult.reason
    }
    if (chaptersResult.status === "rejected") {
      await audioCleanupPromise
      throw chaptersResult.reason
    }
    if (metadataResult.status === "rejected") {
      await audioCleanupPromise
      throw metadataResult.reason
    }
    if (embeddingsResult.status === "rejected") {
      await audioCleanupPromise
      throw embeddingsResult.reason
    }

    await markStepRunning(input.jobId, "mux_upload")
    try {
      const currentJob = await getJob(input.jobId)
      if (!currentJob) {
        throw new Error(`Job ${input.jobId} not found while preparing Mux sync`)
      }

      const muxSyncReport = await stepMuxUpload({
        jobId: input.jobId,
        assetId: input.assetId,
        muxAssetId: input.muxAssetId,
        translationResults: translationResult.value.result,
        previousReport: getMuxSyncReport(currentJob.artifacts),
      })

      const persisted = await updateJob(input.jobId, {
        artifacts: setMuxSyncReport(currentJob.artifacts, muxSyncReport),
      })
      if (!persisted) {
        throw new Error(
          `Failed to persist Mux sync report for job ${input.jobId}`,
        )
      }

      const failedComparisons = muxSyncReport.comparisons.filter(
        (comparison) => comparison.status === "failed",
      )
      if (failedComparisons.length > 0) {
        throw new Error(
          failedComparisons
            .map((comparison) => comparison.explanation)
            .join("; "),
        )
      }

      await markStepComplete(input.jobId, "mux_upload")
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error"
      await markStepFailed(input.jobId, "mux_upload", msg)
      await audioCleanupPromise
      throw err
    }

    if (audioCleanupPromise) {
      await audioCleanupPromise
    } else {
      await markStepSkipped(input.jobId, "audio_cleanup")
    }

    // Optional: Scene analysis (chapters → scene boundaries → OpenRouter + stills)
    // Uses the transcript already produced by enrichment, not a VTT fetch.
    // Error-isolated: scene analysis failure does not block core enrichment.
    if (input.runSceneAnalysis) {
      try {
        const { extractAndStoreSceneBoundaries } =
          await import("@/services/sceneBoundaries")
        const { analyzeAllScenes } = await import("@/services/sceneAnalysis")
        const { syncSceneAnalysisEmbeddings } =
          await import("@/services/sceneEmbeddingSync")
        const { getMuxAsset } = await import("@/services/mux")

        const boundaries = await extractAndStoreSceneBoundaries(
          input.assetId,
          chaptersResult.value.result.chapters,
          transcription.text,
        )

        const muxAsset = await getMuxAsset(input.muxAssetId)
        const analysisResult = await analyzeAllScenes(
          input.assetId,
          muxAsset.playbackId,
          boundaries.scenes,
          {
            videoLabel: input.videoLabel ?? "unknown",
            bibleVerses: input.bibleVerses,
          },
        )

        const sceneEmbeddingSyncReport = await syncSceneAnalysisEmbeddings({
          assetId: input.assetId,
          videoDocumentId: input.videoDocumentId,
          muxAssetId: input.muxAssetId,
          playbackId: muxAsset.playbackId,
          language: transcription.language,
          analysisResult,
        })

        if (
          sceneEmbeddingSyncReport.status === "failed" ||
          sceneEmbeddingSyncReport.status === "unsupported"
        ) {
          console.error(
            JSON.stringify({
              event: "scene_embedding_sync_issue_in_enrichment",
              jobId: input.jobId,
              status: sceneEmbeddingSyncReport.status,
              reason: sceneEmbeddingSyncReport.reason ?? "unknown",
            }),
          )
        }

        await persistMergedArtifacts(
          input.jobId,
          buildSceneEmbeddingSyncArtifact(sceneEmbeddingSyncReport),
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

    await markStepSkipped(input.jobId, "seo_improvements")

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
  requestedProvider: RequestedTranscriptionProvider | undefined,
  artifacts: JobArtifactManifest,
) {
  "use step"
  const { getTranscriptionRoutingReport } =
    await import("@/lib/transcription-routing-report")
  const { transcribe } = await import("@/services/transcription")
  const priorRoutingReport = getTranscriptionRoutingReport(artifacts)
  return transcribe(assetId, muxAssetId, language, {
    requestedProvider,
    sourceInputUrl: priorRoutingReport?.sourceInputUrl,
    priorRoutingReport,
  })
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

async function stepMuxUpload(input: {
  jobId: string
  assetId: string
  muxAssetId: string
  translationResults: LanguageResult[]
  previousReport?: MuxSyncReport
}) {
  "use step"
  const { syncTranslatedSubtitlesToMux } = await import("@/services/mux-sync")
  return syncTranslatedSubtitlesToMux(input)
}
