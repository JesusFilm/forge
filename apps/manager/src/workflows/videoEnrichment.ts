// NOTE: The "use workflow" and "use step" directives require the workflow SDK's
// build plugin to be active for durable execution. Without the plugin configured
// in next.config.ts, these directives are inert and the workflow runs as a plain
// async function (no durability, no step-level retries, no checkpointing).
// To enable: configure the workflow plugin and set WORKFLOW_API_KEY in env.
// See: https://useworkflow.dev/
//
// Video enrichment workflow — orchestrates the full pipeline for a single video asset.
// Steps: transcribe -> translate -> chapters -> metadata -> embeddings -> voiceover (optional)
//
// Uses the `workflow` package ("use workflow" / "use step" directives)
// for durable execution. Each step is idempotent.

import { buildJobArtifactUrl } from "@/lib/job-artifacts"
import { updateJob, updateStepStatus } from "@/lib/state"
import type { WorkflowStepName } from "@/types/job"
import { buildVoiceoverInputs } from "./videoEnrichment-voiceover"

export type VideoEnrichmentInput = {
  jobId: string
  assetId: string
  muxAssetId: string
  language?: string
  translateTo?: string[]
  generateVoiceover?: boolean
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

async function trackArtifact(
  jobId: string,
  artifacts: Record<string, string>,
  key: string,
  artifactType: string,
  ext: string,
): Promise<Record<string, string>> {
  const nextArtifacts = {
    ...artifacts,
    [key]: buildJobArtifactUrl(jobId, artifactType, ext),
  }

  await updateJob(jobId, { artifacts: nextArtifacts })
  return nextArtifacts
}

export async function runVideoEnrichment(
  input: VideoEnrichmentInput,
): Promise<VideoEnrichmentOutput> {
  "use workflow"

  const language = input.language ?? "en"

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
    let trackedArtifacts: Record<string, string> = {}

    // Step 1: Transcription
    await markStepRunning(input.jobId, "transcription")
    const transcription = await stepTranscribe(
      input.assetId,
      input.muxAssetId,
      language,
    )
    await markStepComplete(input.jobId, "transcription")
    trackedArtifacts = await trackArtifact(
      input.jobId,
      trackedArtifacts,
      "transcript",
      "transcript",
      "json",
    )
    if (transcription.segments.length > 0) {
      trackedArtifacts = await trackArtifact(
        input.jobId,
        trackedArtifacts,
        "subtitlesVtt",
        "subtitles",
        "vtt",
      )
    }

    // Steps 2-5: Translation, chapters, metadata, embeddings
    // These all depend only on transcription.text, so run them in parallel.
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
    ): Promise<T> {
      try {
        const result = await fn()
        await markStepComplete(input.jobId, stepName)
        return result
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error"
        await markStepFailed(input.jobId, stepName, msg)
        throw err
      }
    }

    const [translationResults, chaptersResult, metadataResult] =
      await Promise.all([
        // Translation: fan out one step per target language
        runParallelStep("translation", () =>
          Promise.all(
            targets.map((targetLang) =>
              stepTranslate(
                input.assetId,
                transcription.text,
                language,
                targetLang,
              ),
            ),
          ),
        ),
        // Chapters
        runParallelStep("chapters", () =>
          stepChapters(input.assetId, transcription.text),
        ),
        // Metadata
        runParallelStep("metadata", () =>
          stepMetadata(input.assetId, transcription.text, language),
        ),
        // Embeddings
        runParallelStep("embeddings", () =>
          stepEmbeddings(input.assetId, transcription.text),
        ),
      ])

    for (const translation of translationResults) {
      trackedArtifacts = await trackArtifact(
        input.jobId,
        trackedArtifacts,
        `translation-${translation.targetLanguage}`,
        `translation-${translation.targetLanguage}`,
        "json",
      )
    }

    trackedArtifacts = await trackArtifact(
      input.jobId,
      trackedArtifacts,
      "chapters",
      "chapters",
      "json",
    )
    trackedArtifacts = await trackArtifact(
      input.jobId,
      trackedArtifacts,
      "metadata",
      "metadata",
      "json",
    )
    trackedArtifacts = await trackArtifact(
      input.jobId,
      trackedArtifacts,
      "embeddings",
      "embeddings",
      "json",
    )

    if (input.generateVoiceover) {
      const voiceoverInputs = buildVoiceoverInputs({
        sourceLanguage: transcription.language,
        sourceText: transcription.text,
        translations: translationResults,
      })

      await markStepRunning(input.jobId, "voiceover")

      try {
        for (const voiceoverInput of voiceoverInputs) {
          await stepVoiceover(
            input.assetId,
            voiceoverInput.text,
            voiceoverInput.language,
          )

          trackedArtifacts = await trackArtifact(
            input.jobId,
            trackedArtifacts,
            `voiceover-${voiceoverInput.language}`,
            `voiceover-${voiceoverInput.language}`,
            "mp3",
          )
        }

        await markStepComplete(input.jobId, "voiceover")
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error"
        await markStepFailed(input.jobId, "voiceover", msg)
        throw err
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
      chapters: chaptersResult.chapters.map((c) => ({
        title: c.title,
        startSeconds: c.startSeconds,
      })),
      tags: metadataResult.tags,
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

async function stepTranslate(
  assetId: string,
  sourceText: string,
  sourceLanguage: string,
  targetLanguage: string,
) {
  "use step"
  const { translate } = await import("@/services/translation")
  return translate(assetId, sourceText, sourceLanguage, targetLanguage)
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

async function stepVoiceover(assetId: string, text: string, language: string) {
  "use step"
  const { generateVoiceover } = await import("@/services/voiceover")
  return generateVoiceover({ assetId, text, language })
}
