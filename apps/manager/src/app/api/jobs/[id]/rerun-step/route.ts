import { after, NextResponse } from "next/server"
import { z } from "zod"
import { authenticateRequest } from "@/lib/auth"
import { getJob, updateJob, updateStepStatus } from "@/lib/state"
import { generateVoiceover } from "@/services/voiceover"
import { readArtifact } from "@/services/storage"
import type { VoiceoverProviderName } from "@/services/tts/types"

const rerunSchema = z.object({
  step: z.literal("voiceover"),
  language: z.string().regex(/^[a-z]{2,3}(-[A-Z]{2})?$/),
  provider: z.enum(["elevenlabs", "google-tts", "amazon-polly"]).optional(),
  voiceId: z
    .string()
    .max(100)
    .regex(/^[a-zA-Z0-9_-]+$/)
    .optional(),
})

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const authError = await authenticateRequest(request)
  if (authError) return authError

  const { id: jobId } = await params

  let rawBody: unknown
  try {
    rawBody = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const parsed = rerunSchema.safeParse(rawBody)
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 400 },
    )
  }

  const { step, language, provider, voiceId } = parsed.data

  const job = await getJob(jobId)
  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 })
  }

  // Concurrency guard: prevent overlapping re-runs
  const stepRecord = job.steps.find((s) => s.name === step)
  if (stepRecord?.status === "running") {
    return NextResponse.json(
      { error: "This step is already being re-run. Please wait." },
      { status: 409 },
    )
  }

  // Job must have completed (or at least the voiceover step must exist)
  if (!stepRecord) {
    return NextResponse.json(
      { error: "Voiceover step not found on this job" },
      { status: 400 },
    )
  }

  // Mark step as running
  await updateStepStatus(jobId, step, "running")

  // Run voiceover in background after response
  after(async () => {
    try {
      // Get the text for this language
      let text: string
      const sourceLanguage = job.languages[0] ?? "en"

      if (language === sourceLanguage) {
        // Source language: read transcript
        const transcriptData = await readArtifact(
          job.muxAssetId,
          "transcription",
          "json",
        )
        const parsed = JSON.parse(new TextDecoder().decode(transcriptData)) as {
          text: string
        }
        text = parsed.text
      } else {
        // Other language: read translation
        const translationData = await readArtifact(
          job.muxAssetId,
          `translation-${language}`,
          "json",
        )
        const parsed = JSON.parse(
          new TextDecoder().decode(translationData),
        ) as { text: string }
        text = parsed.text
      }

      const result = await generateVoiceover({
        assetId: job.muxAssetId,
        language,
        text,
        provider: provider as VoiceoverProviderName | undefined,
        voiceId,
      })

      // Update per-language artifact in job (stored as JSON string in artifacts map)
      const currentJob = await getJob(jobId)
      const existingVoiceover: Record<string, string> = currentJob?.artifacts
        .voiceover
        ? (JSON.parse(currentJob.artifacts.voiceover) as Record<string, string>)
        : {}
      existingVoiceover[language] = result.artifactKey
      await updateJob(jobId, {
        artifacts: {
          ...(currentJob?.artifacts ?? {}),
          voiceover: JSON.stringify(existingVoiceover),
        },
      })

      await updateStepStatus(jobId, step, "completed")

      console.log(
        JSON.stringify({
          event: "rerun_voiceover_complete",
          jobId,
          language,
          provider: result.metadata.provider,
          artifactKey: result.artifactKey,
        }),
      )
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error"
      console.error(
        JSON.stringify({
          event: "rerun_voiceover_failed",
          jobId,
          language,
          error: msg,
        }),
      )
      await updateStepStatus(jobId, step, "failed", msg).catch(console.error)
    }
  })

  return NextResponse.json(
    { message: "Re-run started", jobId, step, language },
    { status: 202 },
  )
}
