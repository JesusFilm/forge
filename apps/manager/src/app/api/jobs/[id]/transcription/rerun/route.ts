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
import { isAudioCleanupConfigured } from "@/services/audioCleanup"
import { getMuxAsset, getMuxStaticRenditionSourceUrl } from "@/services/mux"
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value != null && !Array.isArray(value)
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value
    : undefined
}

function pruneArtifactsForTranscriptionRerun(
  artifacts: NonNullable<Awaited<ReturnType<typeof getJob>>>["artifacts"],
) {
  const nextArtifacts = { ...artifacts }

  delete nextArtifacts.chapters
  delete nextArtifacts.metadata
  delete nextArtifacts.embeddings
  delete nextArtifacts.translations
  delete nextArtifacts.muxSync
  delete nextArtifacts["transcript-raw"]
  delete nextArtifacts["subtitles-raw"]
  delete nextArtifacts["transcript-correction-report"]

  for (const key of Object.keys(nextArtifacts)) {
    if (
      key.startsWith("subtitles-") ||
      key.startsWith("translation-") ||
      key.startsWith("subtitle-validation-")
    ) {
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
  sourceInputUrl?: string,
): TranscriptionRoutingReport {
  const sourceReport = sourceInputUrl
    ? buildInitialTranscriptionRoutingReport({ sourceInputUrl })
    : undefined
  const baseReport = {
    ...(existing ?? buildInitialTranscriptionRoutingReport()),
    ...(sourceReport?.sourceInputUrl
      ? { sourceInputUrl: sourceReport.sourceInputUrl }
      : {}),
    ...(sourceReport?.sourceInputHost
      ? { sourceInputHost: sourceReport.sourceInputHost }
      : {}),
  }
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

function readDirectMaterializationSourceAssetId(
  artifacts: NonNullable<Awaited<ReturnType<typeof getJob>>>["artifacts"],
): string | undefined {
  const artifact = artifacts.materialization
  if (artifact?.kind !== "metadata" || !isRecord(artifact.data)) {
    return undefined
  }

  const mode = readString(artifact.data.mode)
  const sourceInputType = readString(artifact.data.sourceInputType)
  if (mode !== "direct_mux_asset_reuse" && sourceInputType !== "mux_asset") {
    return undefined
  }

  return (
    readString(artifact.data.sourceMuxAssetId) ??
    readString(artifact.data.reusedMuxAssetId)
  )
}

async function recoverDirectMuxSourceInputUrl(
  job: NonNullable<Awaited<ReturnType<typeof getJob>>>,
): Promise<string | undefined> {
  const sourceMuxAssetId = readDirectMaterializationSourceAssetId(job.artifacts)
  if (!sourceMuxAssetId) {
    return undefined
  }

  try {
    return (
      getMuxStaticRenditionSourceUrl(await getMuxAsset(sourceMuxAssetId)) ??
      undefined
    )
  } catch {
    return undefined
  }
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
  const sourceInputUrl =
    existingRoutingReport?.sourceInputUrl ??
    (provider === "elevenlabs"
      ? await recoverDirectMuxSourceInputUrl(
          job as NonNullable<Awaited<ReturnType<typeof getJob>>>,
        )
      : undefined)
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
    sourceInputUrl,
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
      runAudioCleanup:
        provider === "elevenlabs" ? isAudioCleanupConfigured() : false,
    })
  } catch (error) {
    console.error(`Transcription rerun failed for job ${updatedJob.id}:`, error)
    const failedJob = await updateJob(updatedJob.id, {
      status: "failed",
      currentStep: undefined,
    }).catch(console.error)

    return NextResponse.json(
      {
        error: "Failed to relaunch enrichment workflow.",
        details: error instanceof Error ? error.message : undefined,
        code: "workflow_launch_failed",
        job: failedJob ?? undefined,
      },
      { status: 502 },
    )
  }

  return NextResponse.json({ job: updatedJob }, { status: 202 })
}
