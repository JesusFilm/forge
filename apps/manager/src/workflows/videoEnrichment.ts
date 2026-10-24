// NOTE: The "use workflow" and "use step" directives require the workflow SDK's
// build plugin to be active for durable execution. Without the plugin configured
// in next.config.ts, these directives are inert and the workflow runs as a plain
// async function (no durability, no step-level retries, no checkpointing).
// To enable: configure the workflow plugin and set WORKFLOW_API_KEY in env.
// See: https://useworkflow.dev/
//
// Video enrichment workflow — orchestrates the full pipeline for a single video asset.
// Steps: transcribe -> translate -> chapters -> metadata -> Mastra transcript embeddings
//
// Uses the `workflow` package ("use workflow" / "use step" directives)
// for durable execution. Each step is idempotent.

import { buildDownloadableArtifactManifest } from "@/lib/job-artifacts"
import { getMuxSyncReport, setMuxSyncReport } from "@/lib/mux-sync-report"
import { setTranscriptionRoutingReport } from "@/lib/transcription-routing-report"
import type { WorkflowStepName } from "@/types/job"
import type {
  JobArtifactManifest,
  JobStepDetails,
  MuxSyncReport,
  RequestedTranscriptionProvider,
  SubtitleValidationStepSummary,
  SubtitleValidationVerdict,
  TranscriptionRoutingReport,
  TranslationLanguageResult,
} from "@/types/job"
import type { Chapter, GenerateChaptersInput } from "@/services/chapters"
import type {
  LanguageResult,
  MastraSubtitleTranslationContext,
} from "@/services/mastra-subtitle-enrichment"
import type { MastraTranscriptEmbeddingResult } from "@/services/mastra-transcript-embeddings"
import type {
  CleanedAudioTranscriptionSource,
  TranscriptionResult,
} from "@/services/transcription"
import type { TranscriptScriptureCorrectionStepSummary } from "@/lib/transcript-scripture-correction"
import {
  stepGetJob,
  stepMergeJobArtifacts,
  stepUpdateJob,
  stepUpdateStepStatus,
} from "@/workflows/jobStateSteps"

type SubtitleTranslationStepResult = {
  mastraRunId: string
  languages: LanguageResult[]
}

type TranscriptScriptureCorrectionStepResult = {
  transcription: TranscriptionResult
  artifactKeys: string[]
  summary: TranscriptScriptureCorrectionStepSummary
  mastraRunId?: string
  mastraStatus?: string
  mastraReason?: string
  retryable?: boolean
}

type MastraStepDetailsError = Error & {
  stepDetails?: JobStepDetails
}

const SUBTITLE_CONTEXT_MAX_BIBLE_REFERENCES = 20
const SUBTITLE_CONTEXT_MAX_BIBLE_REFERENCE_CHARS = 80
const BIBLE_REFERENCE_PATTERN =
  /^(?:[1-3]\s*)?[A-Za-z][A-Za-z .'-]{1,40}\s+\d{1,3}(?::\d{1,3}(?:[-–]\d{1,3})?)?(?:\s*[-–]\s*\d{1,3}(?::\d{1,3}(?:[-–]\d{1,3})?)?)?$/

function buildMastraFailureStepDetails(input: {
  mastraRunId?: string
  status?: string
  reason?: string
  retryable?: boolean
  languages?: LanguageResult[]
}): JobStepDetails | undefined {
  const details: JobStepDetails = {}
  if (input.mastraRunId) {
    details.mastra = {
      runId: input.mastraRunId,
      ...(input.status ? { status: input.status } : {}),
      ...(input.reason ? { reason: input.reason } : {}),
      ...(input.retryable !== undefined ? { retryable: input.retryable } : {}),
      ...(input.languages
        ? { languages: input.languages.map((language) => language.lang) }
        : {}),
    }
  }

  if (input.languages && input.languages.length > 0) {
    details.languageResults = input.languages.map((result) => ({
      lang: result.lang,
      status: result.status,
      error: result.error,
    }))
    const subtitleValidation = getSubtitleValidationStepSummary(input.languages)
    if (subtitleValidation) {
      details.subtitleValidation = subtitleValidation
    }
  }

  return details.mastra || details.languageResults ? details : undefined
}

function errorWithStepDetails(
  message: string,
  details: JobStepDetails | undefined,
): MastraStepDetailsError {
  const error = new Error(message) as MastraStepDetailsError
  if (details) {
    error.stepDetails = details
  }
  return error
}

function getStepDetailsFromError(error: unknown): JobStepDetails | undefined {
  if (typeof error !== "object" || error == null) {
    return undefined
  }

  const details = (error as { stepDetails?: unknown }).stepDetails
  if (
    typeof details !== "object" ||
    details == null ||
    Array.isArray(details)
  ) {
    return undefined
  }

  return details as JobStepDetails
}

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
  videoTitle?: string
  videoLabel?: string
  bibleVerses?: string[]
  initialArtifacts?: JobArtifactManifest
  videoDocumentId?: string
  requestedTranscriptionProvider?: RequestedTranscriptionProvider
}

function mergeArtifactEntries(
  existing: JobArtifactManifest,
  incoming: JobArtifactManifest,
): JobArtifactManifest {
  return {
    ...existing,
    ...incoming,
  }
}

export type VideoEnrichmentOutput = {
  assetId: string
  transcript: string
  language: string
  chapters: { title: string; startSeconds: number }[]
  tags: string[]
}

function cleanOptionalString(
  value: string | null | undefined,
): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

function cleanBibleReference(value: string): string | undefined {
  const trimmed = value.trim().replace(/\s+/g, " ")
  if (
    !trimmed ||
    trimmed.length > SUBTITLE_CONTEXT_MAX_BIBLE_REFERENCE_CHARS ||
    !BIBLE_REFERENCE_PATTERN.test(trimmed)
  ) {
    return undefined
  }
  return trimmed
}

function buildSubtitleTranslationContext(input: {
  videoTitle?: string
  videoLabel?: string
  bibleVerses?: string[]
}): MastraSubtitleTranslationContext | undefined {
  const bibleReferences = Array.from(
    new Set(
      (input.bibleVerses ?? [])
        .map(cleanBibleReference)
        .filter((reference): reference is string => reference != null),
    ),
  ).slice(0, SUBTITLE_CONTEXT_MAX_BIBLE_REFERENCES)
  const context: MastraSubtitleTranslationContext = {
    ...(cleanOptionalString(input.videoTitle)
      ? { videoTitle: cleanOptionalString(input.videoTitle) }
      : {}),
    ...(cleanOptionalString(input.videoLabel)
      ? { videoLabel: cleanOptionalString(input.videoLabel) }
      : {}),
    ...(bibleReferences.length > 0 ? { bibleReferences } : {}),
  }

  return Object.keys(context).length > 0 ? context : undefined
}

async function markStepRunning(jobId: string, step: WorkflowStepName) {
  await stepUpdateStepStatus(jobId, step, "running")
  await stepUpdateJob(jobId, { status: "running", currentStep: step })
}

async function markStepComplete(
  jobId: string,
  step: WorkflowStepName,
  details?: JobStepDetails,
) {
  if (details === undefined) {
    await stepUpdateStepStatus(jobId, step, "completed")
    return
  }

  await stepUpdateStepStatus(jobId, step, "completed", undefined, details)
}

async function markStepFailed(
  jobId: string,
  step: WorkflowStepName,
  error: string,
  details?: JobStepDetails,
) {
  if (details === undefined) {
    await stepUpdateStepStatus(jobId, step, "failed", error)
    return
  }

  await stepUpdateStepStatus(jobId, step, "failed", error, details)
}

async function markStepSkipped(jobId: string, step: WorkflowStepName) {
  await stepUpdateStepStatus(jobId, step, "skipped")
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
  const updated = await stepUpdateJob(jobId, { artifacts })
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

  const updated = await stepMergeJobArtifacts(jobId, artifacts)
  if (!updated) {
    throw new Error(`Failed to persist artifact manifest for job ${jobId}`)
  }
}

function getTranslationArtifactManifest({
  languages,
}: SubtitleTranslationStepResult): JobArtifactManifest {
  return buildDownloadableArtifactManifest(
    languages.flatMap((result) => {
      if (result.status !== "completed") {
        return []
      }
      return [
        `subtitles-${result.lang}`,
        `translation-${result.lang}`,
        ...(result.artifactKeys?.validation
          ? [`subtitle-validation-${result.lang}`]
          : []),
      ]
    }),
  )
}

const VALIDATION_VERDICT_RANK: Record<SubtitleValidationVerdict, number> = {
  pass: 0,
  unavailable: 1,
  warning: 2,
  needs_review: 3,
}

function highestSubtitleValidationVerdict(
  verdicts: SubtitleValidationVerdict[],
): SubtitleValidationVerdict {
  return verdicts.reduce<SubtitleValidationVerdict>(
    (highest, verdict) =>
      VALIDATION_VERDICT_RANK[verdict] > VALIDATION_VERDICT_RANK[highest]
        ? verdict
        : highest,
    "pass",
  )
}

function getSubtitleValidationStepSummary(
  languages: LanguageResult[],
): SubtitleValidationStepSummary | undefined {
  const results = languages.flatMap((result) =>
    result.validationSummary
      ? [
          {
            lang: result.lang,
            ...result.validationSummary,
          },
        ]
      : [],
  )
  if (results.length === 0) {
    return undefined
  }

  return {
    highestVerdict: highestSubtitleValidationVerdict(
      results.map((result) => result.verdict),
    ),
    languagesChecked: results.length,
    modelOnlyLanguages: results
      .filter((result) => result.basis === "model_knowledge")
      .map((result) => result.lang),
    unavailableLanguages: results
      .filter(
        (result) =>
          result.basis === "unavailable" || result.verdict === "unavailable",
      )
      .map((result) => result.lang),
    warningCount: results.reduce(
      (total, result) => total + result.warningCount,
      0,
    ),
    needsReviewCount: results.reduce(
      (total, result) => total + result.needsReviewCount,
      0,
    ),
    results,
  }
}

function getTranslationStepDetails(
  result: SubtitleTranslationStepResult,
): JobStepDetails | undefined {
  const languageResults: TranslationLanguageResult[] = result.languages.map(
    (result) => ({
      lang: result.lang,
      status: result.status,
      error: result.error,
    }),
  )
  const subtitleValidation = getSubtitleValidationStepSummary(result.languages)

  return {
    ...(languageResults.length > 0 ? { languageResults } : {}),
    ...(subtitleValidation ? { subtitleValidation } : {}),
    mastra: {
      runId: result.mastraRunId,
      status: "completed",
      languages: result.languages.map((language) => language.lang),
    },
  }
}

function getTranscriptEmbeddingsStepDetails(
  result: Extract<MastraTranscriptEmbeddingResult, { ok: true }>,
): JobStepDetails {
  return {
    mastra: {
      runId: result.mastraRunId,
      status: result.status,
      provider: result.provider,
      model: result.model,
      chunks: result.chunks,
      totalTokens: result.totalTokens,
      sourceContentHash: result.sourceContentHash,
    },
  }
}

function getTranscriptCorrectionStepDetails(
  result: TranscriptScriptureCorrectionStepResult,
): JobStepDetails {
  return {
    transcriptCorrection: result.summary,
    ...(result.mastraRunId || result.mastraReason
      ? {
          mastra: {
            runId: result.mastraRunId ?? "unavailable",
            status: result.mastraStatus,
            reason: result.mastraReason,
            retryable: result.retryable,
          },
        }
      : {}),
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

  await stepUpdateJob(input.jobId, {
    status: "running",
    startedAt: new Date().toISOString(),
  })

  try {
    async function runAudioCleanupStep(): Promise<CleanedAudioTranscriptionSource> {
      try {
        await markStepRunning(input.jobId, "audio_cleanup")
        const audioCleanupResult = await stepAudioCleanup({
          assetId: input.assetId,
          muxAssetId: input.muxAssetId,
          playbackId: input.playbackId,
        })
        await persistMergedArtifacts(
          input.jobId,
          buildDownloadableArtifactManifest(audioCleanupResult.artifactKeys),
        )
        await markStepComplete(input.jobId, "audio_cleanup")
        return {
          assetId: input.assetId,
          artifactType: "cleaned-audio",
          ext: "mp3",
        }
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
            event: "audio_cleanup_failed_before_transcription",
            jobId: input.jobId,
            error: msg,
          }),
        )
        throw audioError
      }
    }

    const cleanedAudioArtifact = input.runAudioCleanup
      ? await runAudioCleanupStep()
      : undefined
    if (!input.runAudioCleanup) {
      await markStepSkipped(input.jobId, "audio_cleanup")
    }

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
        cleanedAudioArtifact,
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

    let transcriptCorrectionResult: TranscriptScriptureCorrectionStepResult
    await markStepRunning(input.jobId, "structured_transcript")
    try {
      transcriptCorrectionResult = await stepTranscriptScriptureCorrection({
        assetId: input.assetId,
        sourceLanguage: transcription.language,
        transcription,
        translationContext: buildSubtitleTranslationContext({
          videoTitle: input.videoTitle,
          videoLabel: input.videoLabel,
          bibleVerses: input.bibleVerses,
        }),
      })
      transcription = transcriptCorrectionResult.transcription
      if (transcriptCorrectionResult.artifactKeys.length > 0) {
        artifactManifest = mergeArtifactEntries(
          artifactManifest,
          buildDownloadableArtifactManifest(
            transcriptCorrectionResult.artifactKeys,
          ),
        )
        await persistArtifacts(input.jobId, artifactManifest)
      }
      await markStepComplete(
        input.jobId,
        "structured_transcript",
        getTranscriptCorrectionStepDetails(transcriptCorrectionResult),
      )
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error"
      await markStepFailed(input.jobId, "structured_transcript", msg)
      throw err
    }

    // Steps 2-5: Translation, chapters, metadata, embeddings
    // Translation and chapters still depend only on transcription.
    // Transcript embeddings now launch Mastra from transcript source data only;
    // Mastra owns chunking and vectors while Admin owns storage.
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
      let stepDetails: JobStepDetails | undefined
      try {
        const result = await fn()
        const artifacts = getArtifacts?.(result) ?? {}
        stepDetails = getDetails?.(result)
        await persistMergedArtifacts(input.jobId, artifacts)
        await markStepComplete(input.jobId, stepName, stepDetails)
        return {
          result,
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error"
        await markStepFailed(
          input.jobId,
          stepName,
          msg,
          getStepDetailsFromError(err) ?? stepDetails,
        )
        throw err
      }
    }

    const translationPromise = runParallelStep(
      "translation",
      () =>
        stepSubtitleTranslation(
          input.assetId,
          language,
          targets,
          buildSubtitleTranslationContext({
            videoTitle: input.videoTitle,
            videoLabel: input.videoLabel,
            bibleVerses: input.bibleVerses,
          }),
        ),
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

    const embeddingsPromise = runParallelStep(
      "embeddings",
      () =>
        stepMastraTranscriptEmbeddings({
          assetId: input.assetId,
          muxAssetId: input.muxAssetId,
          language: transcription.language,
          transcript: transcription.text,
          segments: transcription.segments,
          provider: transcription.resolvedProvider,
        }),
      undefined,
      getTranscriptEmbeddingsStepDetails,
    )

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

    await markStepRunning(input.jobId, "mux_upload")
    try {
      const currentJob = await stepGetJob(input.jobId)
      if (!currentJob) {
        throw new Error(`Job ${input.jobId} not found while preparing Mux sync`)
      }

      const muxSyncReport = await stepMuxUpload({
        jobId: input.jobId,
        assetId: input.assetId,
        muxAssetId: input.muxAssetId,
        translationResults: translationResult.value.result.languages,
        previousReport: getMuxSyncReport(currentJob.artifacts),
      })

      const persisted = await stepUpdateJob(input.jobId, {
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
      throw err
    }

    // Optional: Scene analysis (chapters → scene boundaries → OpenRouter + stills)
    // Uses the transcript already produced by enrichment, not a VTT fetch.
    // Error-isolated: scene analysis failure does not block core enrichment.
    if (input.runSceneAnalysis) {
      try {
        await stepSceneAnalysis({
          assetId: input.assetId,
          muxAssetId: input.muxAssetId,
          language: transcription.language,
          transcript: transcription.text,
          chapters: chaptersResult.value.result.chapters,
          videoLabel: input.videoLabel ?? "unknown",
          bibleVerses: input.bibleVerses,
        })
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
    await stepUpdateJob(input.jobId, {
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
    await stepUpdateJob(input.jobId, {
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
  cleanedAudioArtifact?: CleanedAudioTranscriptionSource,
) {
  "use step"
  const { getTranscriptionRoutingReport } =
    await import("@/lib/transcription-routing-report")
  const { transcribe } = await import("@/services/transcription")
  const priorRoutingReport = getTranscriptionRoutingReport(artifacts)
  return transcribe(assetId, muxAssetId, language, {
    requestedProvider,
    sourceInputUrl: priorRoutingReport?.sourceInputUrl,
    cleanedAudioArtifact,
    priorRoutingReport,
  })
}

async function stepSubtitleTranslation(
  assetId: string,
  sourceLanguage: string,
  targetLanguages: string[],
  translationContext?: MastraSubtitleTranslationContext,
) {
  "use step"
  const { launchMastraSubtitleEnrichment } =
    await import("@/services/mastra-subtitle-enrichment")
  const result = await launchMastraSubtitleEnrichment({
    assetId,
    sourceLanguage,
    targetLanguages,
    ...(translationContext ? { translationContext } : {}),
  })

  if (!result.ok) {
    throw errorWithStepDetails(
      `Mastra subtitle enrichment failed (${result.reason})${result.message ? `: ${result.message}` : ""}`,
      buildMastraFailureStepDetails({
        mastraRunId: result.mastraRunId,
        status: "failed",
        reason: result.reason,
        retryable: result.retryable,
        languages: result.languages,
      }),
    )
  }

  return {
    mastraRunId: result.mastraRunId,
    languages: result.languages,
  }
}

async function stepTranscriptScriptureCorrection(input: {
  assetId: string
  sourceLanguage: string
  transcription: TranscriptionResult
  translationContext?: MastraSubtitleTranslationContext
}): Promise<TranscriptScriptureCorrectionStepResult> {
  "use step"
  const { writeArtifact } = await import("@/services/storage")
  const { segmentsToVTT } = await import("@/lib/vtt")
  const { launchMastraTranscriptScriptureCorrection } =
    await import("@/services/mastra-transcript-scripture-correction")
  const {
    applyTranscriptScriptureCorrections,
    buildTranscriptCorrectionReport,
  } = await import("@/services/transcript-scripture-correction")

  const mastraResult = await launchMastraTranscriptScriptureCorrection({
    assetId: input.assetId,
    sourceLanguage: input.sourceLanguage,
    segments: input.transcription.segments,
    ...(input.translationContext
      ? { translationContext: input.translationContext }
      : {}),
    provider: { name: input.transcription.resolvedProvider },
  })
  const correction = mastraResult.ok
    ? mastraResult.correction
    : {
        status: "unavailable" as const,
        basis: "unavailable" as const,
        contentDomain: "christian_general" as const,
        confidence: 0,
        checkedReferenceCount: 0,
        candidateCount: 0,
        flaggedCount: 0,
        unavailableReason: mastraResult.reason,
        likelyBibleReferences: [],
        findings: [],
      }
  const application = applyTranscriptScriptureCorrections({
    text: input.transcription.text,
    segments: input.transcription.segments,
    correction,
  })
  const artifactKeys = ["transcript-correction-report"]

  if (application.changed) {
    await writeArtifact({
      assetId: input.assetId,
      artifactType: "transcript-raw",
      ext: "json",
      body: JSON.stringify(
        {
          text: input.transcription.text,
          segments: input.transcription.segments,
          language: input.transcription.language,
          resolvedProvider: input.transcription.resolvedProvider,
          routingReport: input.transcription.routingReport,
        },
        null,
        2,
      ),
      contentType: "application/json",
    })
    artifactKeys.push("transcript-raw")

    if (input.transcription.segments.length > 0) {
      await writeArtifact({
        assetId: input.assetId,
        artifactType: "subtitles-raw",
        ext: "vtt",
        body: segmentsToVTT(input.transcription.segments),
        contentType: "text/vtt",
      })
      artifactKeys.push("subtitles-raw")
    }

    await writeArtifact({
      assetId: input.assetId,
      artifactType: "transcript",
      ext: "json",
      body: JSON.stringify(
        {
          text: application.text,
          segments: application.segments,
          language: input.transcription.language,
          resolvedProvider: input.transcription.resolvedProvider,
          routingReport: input.transcription.routingReport,
        },
        null,
        2,
      ),
      contentType: "application/json",
    })
    artifactKeys.push("transcript")

    if (application.segments.length > 0) {
      await writeArtifact({
        assetId: input.assetId,
        artifactType: "subtitles",
        ext: "vtt",
        body: segmentsToVTT(application.segments),
        contentType: "text/vtt",
      })
      artifactKeys.push("subtitles")
    }
  }

  await writeArtifact({
    assetId: input.assetId,
    artifactType: "transcript-correction-report",
    ext: "json",
    body: JSON.stringify(
      buildTranscriptCorrectionReport(application.summary),
      null,
      2,
    ),
    contentType: "application/json",
  })

  return {
    transcription: {
      ...input.transcription,
      text: application.text,
      segments: application.segments,
      artifactKeys: Array.from(
        new Set([...input.transcription.artifactKeys, ...artifactKeys]),
      ),
    },
    artifactKeys,
    summary: application.summary,
    ...(mastraResult.ok
      ? {
          mastraRunId: mastraResult.mastraRunId,
          mastraStatus: mastraResult.correction.status,
        }
      : {
          mastraReason: mastraResult.reason,
          retryable: mastraResult.retryable,
        }),
  }
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

async function stepMastraTranscriptEmbeddings(input: {
  assetId: string
  muxAssetId: string
  language: string
  transcript: string
  segments: Array<{ start: number; end: number; text: string }>
  provider?: string
}) {
  "use step"
  const { launchMastraTranscriptEmbeddings } =
    await import("@/services/mastra-transcript-embeddings")
  const result = await launchMastraTranscriptEmbeddings({
    assetId: input.assetId,
    muxAssetId: input.muxAssetId,
    language: input.language,
    transcript: {
      text: input.transcript,
      segments: input.segments,
      artifactKey: `${input.assetId}/transcript.json`,
      provider: input.provider,
    },
  })

  if (!result.ok) {
    throw errorWithStepDetails(
      `Mastra transcript embedding failed for assetId=${input.assetId}: ${result.reason}`,
      buildMastraFailureStepDetails({
        mastraRunId: result.mastraRunId,
        status: "failed",
        reason: result.reason,
        retryable: result.retryable,
      }),
    )
  }

  return result
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

async function stepAudioCleanup(input: {
  assetId: string
  muxAssetId: string
  playbackId?: string
}) {
  "use step"
  const { runAudioCleanup } = await import("@/services/audioCleanup")
  const { getMuxAsset, getPlaybackUrl } = await import("@/services/mux")
  const playbackId =
    input.playbackId ?? (await getMuxAsset(input.muxAssetId)).playbackId

  return runAudioCleanup({
    assetId: input.assetId,
    sourceVideoUrl: getPlaybackUrl(playbackId),
  })
}

async function stepSceneAnalysis(input: {
  assetId: string
  muxAssetId: string
  language: string
  transcript: string
  chapters: Chapter[]
  videoLabel: string
  bibleVerses?: string[]
}) {
  "use step"

  const { extractAndStoreSceneBoundaries } =
    await import("@/services/sceneBoundaries")
  const { analyzeAllScenes } = await import("@/services/sceneAnalysis")
  const { getMuxAsset } = await import("@/services/mux")

  const boundaries = await extractAndStoreSceneBoundaries(
    input.assetId,
    input.chapters,
    input.transcript,
  )

  const muxAsset = await getMuxAsset(input.muxAssetId)
  return analyzeAllScenes(
    input.assetId,
    muxAsset.playbackId,
    boundaries.scenes,
    {
      videoLabel: input.videoLabel,
      bibleVerses: input.bibleVerses,
      inputLanguageBcp47: input.language,
      muxAssetId: input.muxAssetId,
      transcriptSource: {
        kind: "mux-transcription",
        languageBcp47: input.language,
        muxAssetId: input.muxAssetId,
      },
    },
  )
}
