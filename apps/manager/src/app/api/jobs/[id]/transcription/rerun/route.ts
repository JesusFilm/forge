import { randomUUID } from "node:crypto"
import { NextResponse } from "next/server"
import { z } from "zod"
import { authenticateRequest } from "@/lib/auth"
import {
  appendTranscriptionAttempt,
  buildInitialTranscriptionRoutingReport,
  getTranscriptionRoutingReport,
  setTranscriptionRoutingReport,
} from "@/lib/transcription-routing-report"
import { buildInitialSteps } from "@/lib/workflow-steps"
import { getJob, updateJob } from "@/lib/state"
import type {
  RequestedTranscriptionProvider,
  TranscriptionAttempt,
  TranscriptionRoutingReport,
} from "@/types/job"
import { isSupportedElevenLabsLanguage } from "@/services/elevenlabs-transcription"
import { normalizeSourceLanguageCode } from "@/services/transcription"
import { launchVideoEnrichment } from "@/workflows/launchVideoEnrichment"

const requestBodySchema = z.object({
  provider: z.enum(["elevenlabs", "mux"]),
})

function isTranscriptionActive(
  job: Awaited<ReturnType<typeof getJob>>,
): boolean {
  return job?.status === "running" && job.currentStep === "transcription"
}

function pruneArtifactsForTranscriptionRerun(
  artifacts: NonNullable<Awaited<ReturnType<typeof getJob>>>["artifacts"],
) {
  const nextArtifacts = { ...artifacts }

  delete nextArtifacts.chapters
  delete nextArtifacts.metadata
  delete nextArtifacts.embeddings
  delete nextArtifacts.embeddingSync
  delete nextArtifacts.sceneEmbeddingSync
  delete nextArtifacts.translations
  delete nextArtifacts.muxSync

  for (const key of Object.keys(nextArtifacts)) {
    if (key.startsWith("subtitles-") || key.startsWith("translation-")) {
      delete nextArtifacts[key]
    }
  }

  return nextArtifacts
}

function buildRunningAttempt(
  provider: RequestedTranscriptionProvider,
): TranscriptionAttempt {
  return {
    attemptId: randomUUID(),
    requestedProvider: provider,
    resolvedProvider: provider === "elevenlabs" ? "elevenlabs" : "mux",
    status: "running",
    startedAt: new Date().toISOString(),
    decisionReason:
      provider === "elevenlabs"
        ? "Operator explicitly requested ElevenLabs transcription."
        : "Operator explicitly requested Mux transcription.",
  }
}

function buildRerunRoutingReport(
  existing: TranscriptionRoutingReport | undefined,
  provider: RequestedTranscriptionProvider,
): TranscriptionRoutingReport {
  const baseReport = existing ?? buildInitialTranscriptionRoutingReport()
  const rerunnableReport = { ...baseReport }
  delete rerunnableReport.currentAttemptId
  delete rerunnableReport.finalProvider
  delete rerunnableReport.finalSourceLanguageCode
  delete rerunnableReport.fallbackReason
  delete rerunnableReport.diarization

  return appendTranscriptionAttempt(
    rerunnableReport,
    buildRunningAttempt(provider),
  )
}

function resolveRerunSourceLanguageCode(
  job: NonNullable<Awaited<ReturnType<typeof getJob>>>,
  existing: TranscriptionRoutingReport | undefined,
): string | null {
  const candidate =
    existing?.finalSourceLanguageCode ?? job.sourceLanguageCode ?? "auto"
  return normalizeSourceLanguageCode(candidate)
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const authError = await authenticateRequest(request)
  if (authError) return authError

  const { id } = await params
  const job = await getJob(id)

  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 })
  }

  if (isTranscriptionActive(job)) {
    return NextResponse.json(
      { error: "Transcription rerun is already in progress" },
      { status: 409 },
    )
  }

  let rawBody: unknown
  try {
    rawBody = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const parsed = requestBodySchema.safeParse(rawBody)
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid rerun request" },
      { status: 400 },
    )
  }

  const provider = parsed.data.provider
  const existingRoutingReport = getTranscriptionRoutingReport(job.artifacts)
  const sourceInputUrl = existingRoutingReport?.sourceInputUrl
  const sourceLanguageCode = resolveRerunSourceLanguageCode(
    job as NonNullable<Awaited<ReturnType<typeof getJob>>>,
    existingRoutingReport,
  )

  if (provider === "elevenlabs" && !sourceInputUrl) {
    return NextResponse.json(
      {
        error:
          "This job does not have a persisted source input URL for ElevenLabs reruns.",
      },
      { status: 409 },
    )
  }

  if (provider === "elevenlabs" && !sourceLanguageCode) {
    return NextResponse.json(
      {
        error:
          "This job does not have a concrete source language for ElevenLabs reruns.",
      },
      { status: 409 },
    )
  }

  if (
    provider === "elevenlabs" &&
    sourceLanguageCode &&
    !isSupportedElevenLabsLanguage(sourceLanguageCode)
  ) {
    return NextResponse.json(
      {
        error: `ElevenLabs does not support source language ${sourceLanguageCode}.`,
      },
      { status: 409 },
    )
  }

  const nextRoutingReport = buildRerunRoutingReport(
    existingRoutingReport,
    provider,
  )
  const nextArtifacts = setTranscriptionRoutingReport(
    pruneArtifactsForTranscriptionRerun(job.artifacts),
    nextRoutingReport,
  )

  const updatedJob = await updateJob(job.id, {
    status: "pending",
    currentStep: undefined,
    completedAt: undefined,
    artifacts: nextArtifacts,
    errors: [],
    steps: buildInitialSteps(),
  })

  if (!updatedJob) {
    return NextResponse.json(
      { error: "Failed to persist transcription rerun request" },
      { status: 500 },
    )
  }

  try {
    await launchVideoEnrichment({
      jobId: updatedJob.id,
      assetId: updatedJob.muxAssetId,
      muxAssetId: updatedJob.muxAssetId,
      language:
        existingRoutingReport?.finalSourceLanguageCode ??
        job.sourceLanguageCode ??
        "auto",
      translateTo: job.languages,
      initialArtifacts: updatedJob.artifacts,
      requestedTranscriptionProvider: provider,
    })
  } catch (error) {
    console.error(`Transcription rerun failed for job ${updatedJob.id}:`, error)
    await updateJob(updatedJob.id, {
      status: "failed",
      currentStep: undefined,
    }).catch(console.error)
  }

  return NextResponse.json({ job: updatedJob }, { status: 202 })
}
