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

import { buildDownloadableArtifactManifest } from "@/lib/job-artifacts"
import { mergeArtifactEntries, updateJob, updateStepStatus } from "@/lib/state"
import type { WorkflowStepName } from "@/types/job"
import type { JobArtifactManifest } from "@/types/job"
import type { LanguageResult } from "@/services/subtitleTranslation/types"

export type VideoEnrichmentInput = {
  jobId: string
  assetId: string
  muxAssetId: string
  language?: string
  translateTo?: string[]
  initialArtifacts?: JobArtifactManifest
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

async function markStepComplete(jobId: string, step: WorkflowStepName) {
  await updateStepStatus(jobId, step, "completed")
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
    // These all depend only on transcription, so run them in parallel.
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
    ): Promise<{ result: T; artifacts: JobArtifactManifest }> {
      try {
        const result = await fn()
        await markStepComplete(input.jobId, stepName)
        return {
          result,
          artifacts: getArtifacts?.(result) ?? {},
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error"
        await markStepFailed(input.jobId, stepName, msg)
        throw err
      }
    }

    const [
      translationResult,
      chaptersResult,
      metadataResult,
      embeddingsResult,
    ] = await Promise.allSettled([
      // Translation: subtitle translation pipeline (reads transcript artifact directly)
      runParallelStep(
        "translation",
        () => stepSubtitleTranslation(input.assetId, language, targets),
        getTranslationArtifactManifest,
      ),
      // Chapters
      runParallelStep(
        "chapters",
        () => stepChapters(input.assetId, transcription.text),
        (result) => buildDownloadableArtifactManifest(result.artifactKeys),
      ),
      // Metadata
      runParallelStep(
        "metadata",
        () => stepMetadata(input.assetId, transcription.text, language),
        (result) => buildDownloadableArtifactManifest(result.artifactKeys),
      ),
      // Embeddings
      runParallelStep(
        "embeddings",
        () => stepEmbeddings(input.assetId, transcription.text),
        (result) => buildDownloadableArtifactManifest(result.artifactKeys),
      ),
    ])

    const successfulArtifacts = [
      translationResult,
      chaptersResult,
      metadataResult,
      embeddingsResult,
    ].reduce((combined, result) => {
      if (result.status === "rejected") {
        return combined
      }

      return mergeArtifactEntries(combined, result.value.artifacts)
    }, {} as JobArtifactManifest)

    if (Object.keys(successfulArtifacts).length > 0) {
      artifactManifest = mergeArtifactEntries(
        artifactManifest,
        successfulArtifacts,
      )
      await persistArtifacts(input.jobId, artifactManifest)
    }

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

async function stepChapters(assetId: string, transcript: string) {
  "use step"
  const { generateChapters } = await import("@/services/chapters")
  return generateChapters(assetId, transcript)
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

async function stepEmbeddings(assetId: string, transcript: string) {
  "use step"
  const { generateEmbeddings } = await import("@/services/embeddings")
  return generateEmbeddings(assetId, transcript)
}
