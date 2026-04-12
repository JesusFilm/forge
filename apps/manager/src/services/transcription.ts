// Transcription service — generates transcripts from Mux's built-in subtitles.
// Uses Mux's generated_subtitles feature — no OpenRouter fallback.
// OpenRouter does not expose a Whisper transcription endpoint.

import { randomUUID } from "node:crypto"
import { env } from "@/config/env"
import {
  appendTranscriptionAttempt,
  buildInitialTranscriptionRoutingReport,
  updateTranscriptionAttempt,
} from "@/lib/transcription-routing-report"
import { ensureGeneratedSubtitlesForAsset, getMux } from "@/services/mux"
import { writeArtifact } from "@/services/storage"
import { parseVTT, segmentsToVTT, type TranscriptSegment } from "@/lib/vtt"
import type {
  RequestedTranscriptionProvider,
  ResolvedTranscriptionProvider,
  TranscriptionAttempt,
  TranscriptionDiarizationSummary,
  TranscriptionRoutingReport,
} from "@/types/job"
import {
  isSupportedElevenLabsLanguage,
  transcribeViaElevenLabs,
} from "@/services/elevenlabs-transcription"

export type { TranscriptSegment }

export type TranscriptionResult = {
  text: string
  segments: TranscriptSegment[]
  language: string
  artifactKeys: string[]
  resolvedProvider: ResolvedTranscriptionProvider
  routingReport: TranscriptionRoutingReport
}

type RawTranscriptionResult = Omit<TranscriptionResult, "artifactKeys">

export class TranscriptionExecutionError extends Error {
  routingReport: TranscriptionRoutingReport

  constructor(
    message: string,
    routingReport: TranscriptionRoutingReport,
    cause?: unknown,
  ) {
    super(message, cause ? { cause } : undefined)
    this.name = "TranscriptionExecutionError"
    this.routingReport = routingReport
  }
}

type MuxPlaybackPolicy = "public" | "signed" | "drm"

type MuxPlaybackId = {
  id?: string | null
  policy?: MuxPlaybackPolicy | null
}

type MuxTrack = {
  id?: string | null
  type?: string | null
  text_type?: string | null
  text_source?: string | null
  language_code?: string | null
  status?: string | null
}

type MuxAssetSnapshot = {
  status?: string | null
  duration?: number | null
  playback_ids?: MuxPlaybackId[] | null
  tracks?: MuxTrack[] | null
}

export type ReadySubtitleTrack = {
  track: MuxTrack & { id: string }
  playbackId: string
  playbackPolicy: MuxPlaybackPolicy
}

const SUBTITLE_TRACK_POLL_INTERVAL_MS = 5_000
const MIN_SUBTITLE_TRACK_TIMEOUT_MS = 2 * 60_000
const MAX_SUBTITLE_TRACK_TIMEOUT_MS = 15 * 60_000
const SUBTITLE_FETCH_TIMEOUT_MS = 30_000

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

function hasMuxSigningKeys(): boolean {
  return Boolean(env.MUX_SIGNING_KEY && env.MUX_PRIVATE_KEY)
}

function isSubtitleTrack(track: MuxTrack): boolean {
  return track.type === "text" && track.text_type === "subtitles"
}

function isGeneratedSubtitleTrack(track: MuxTrack): boolean {
  return track.text_source === "generated_vod"
}

function normalizeRequestedLanguage(language: string): string | null {
  if (!language || language === "auto") {
    return null
  }
  return language.toLowerCase()
}

function chooseBestSubtitleTrack(
  tracks: MuxTrack[],
  language: string,
): (MuxTrack & { id: string }) | null {
  const requestedLanguage = normalizeRequestedLanguage(language)
  const ranked = tracks
    .filter(
      (track): track is MuxTrack & { id: string } =>
        Boolean(track.id) && isSubtitleTrack(track),
    )
    .map((track) => ({
      track,
      score:
        (isGeneratedSubtitleTrack(track) ? 100 : 0) +
        (requestedLanguage &&
        track.language_code?.toLowerCase() === requestedLanguage
          ? 10
          : 0) +
        (track.language_code === "auto" ? 1 : 0),
    }))
    .sort((a, b) => b.score - a.score)

  return ranked[0]?.track ?? null
}

function choosePlaybackId(
  playbackIds: MuxPlaybackId[] | null | undefined,
): { id: string; policy: MuxPlaybackPolicy } | null {
  const available = (playbackIds ?? []).filter(
    (playbackId): playbackId is { id: string; policy: MuxPlaybackPolicy } =>
      Boolean(playbackId.id) && Boolean(playbackId.policy),
  )

  return (
    available.find((playbackId) => playbackId.policy === "public") ??
    available.find((playbackId) => playbackId.policy === "signed") ??
    available.find((playbackId) => playbackId.policy === "drm") ??
    null
  )
}

export function calculateSubtitleTrackTimeoutMs(
  durationSeconds: number | null | undefined,
): number {
  if (!durationSeconds || durationSeconds <= 0) {
    return MIN_SUBTITLE_TRACK_TIMEOUT_MS
  }

  return Math.max(
    MIN_SUBTITLE_TRACK_TIMEOUT_MS,
    Math.min(
      MAX_SUBTITLE_TRACK_TIMEOUT_MS,
      Math.round(durationSeconds * 1000 * 0.1 + 60_000),
    ),
  )
}

export async function buildMuxTextTrackUrl(
  playbackId: string,
  trackId: string,
  playbackPolicy: MuxPlaybackPolicy,
): Promise<string> {
  if (playbackPolicy === "drm") {
    throw new Error(
      "DRM playback IDs are not supported for generated subtitle transcription.",
    )
  }

  const url = new URL(
    `https://stream.mux.com/${playbackId}/text/${trackId}.vtt`,
  )

  if (playbackPolicy === "signed") {
    if (!hasMuxSigningKeys()) {
      throw new Error(
        "Mux signing keys are required to fetch subtitles from signed playback assets.",
      )
    }

    const token = await getMux().jwt.signPlaybackId(playbackId, {
      type: "video",
      expiration: "5m",
    })
    url.searchParams.set("token", token)
  }

  return url.toString()
}

export async function waitForReadySubtitleTrack(
  muxAssetId: string,
  language: string,
  options?: {
    pollIntervalMs?: number
    timeoutMs?: number
    retrieveAsset?: (muxAssetId: string) => Promise<MuxAssetSnapshot>
  },
): Promise<ReadySubtitleTrack> {
  const retrieveAsset =
    options?.retrieveAsset ??
    ((assetId: string) => getMux().video.assets.retrieve(assetId))
  const pollIntervalMs =
    options?.pollIntervalMs ?? SUBTITLE_TRACK_POLL_INTERVAL_MS

  const startedAt = Date.now()
  let timeoutMs = options?.timeoutMs
  let attempts = 0

  while (true) {
    attempts += 1
    const asset = await retrieveAsset(muxAssetId)
    timeoutMs ??= calculateSubtitleTrackTimeoutMs(asset.duration)

    const readyTrack = chooseBestSubtitleTrack(
      (asset.tracks ?? []).filter((track) => track.status === "ready"),
      language,
    )
    const playbackId = choosePlaybackId(asset.playback_ids)

    if (readyTrack && playbackId) {
      return {
        track: readyTrack,
        playbackId: playbackId.id,
        playbackPolicy: playbackId.policy,
      }
    }

    const erroredTrack = chooseBestSubtitleTrack(
      (asset.tracks ?? []).filter((track) => track.status === "errored"),
      language,
    )

    if (asset.status === "errored") {
      throw new Error(
        `Mux asset ${muxAssetId} failed while generating subtitles.`,
      )
    }

    if (erroredTrack) {
      throw new Error(
        `Mux subtitle track ${erroredTrack.id} errored while generating subtitles.`,
      )
    }

    const waitedMs = Date.now() - startedAt
    if (waitedMs >= timeoutMs) {
      throw new Error(
        `Timed out waiting for a ready subtitle track on Mux asset ${muxAssetId} after ${Math.round(waitedMs / 1000)}s.`,
      )
    }

    console.log(
      JSON.stringify({
        event: "transcription_waiting_for_subtitles",
        muxAssetId,
        attempt: attempts,
        waitedMs,
      }),
    )

    await sleep(pollIntervalMs)
  }
}

// Retrieve Mux-generated subtitles and parse into transcript.
export async function transcribe(
  assetId: string,
  muxAssetId: string,
  language = "auto",
  options?: {
    requestedProvider?: RequestedTranscriptionProvider
    sourceInputUrl?: string
    keyterms?: string[]
    priorRoutingReport?: TranscriptionRoutingReport
  },
): Promise<TranscriptionResult> {
  const result = await resolveTranscriptionResult(muxAssetId, language, options)
  const artifactKeys = ["transcript"]

  await writeArtifact({
    assetId,
    artifactType: "transcript",
    ext: "json",
    body: JSON.stringify(result, null, 2),
    contentType: "application/json",
  })

  if (result.segments.length > 0) {
    const vtt = segmentsToVTT(result.segments)
    await writeArtifact({
      assetId,
      artifactType: "subtitles",
      ext: "vtt",
      body: vtt,
      contentType: "text/vtt",
    })
    artifactKeys.push("subtitles")
  }

  return {
    ...result,
    artifactKeys,
  }
}

async function transcribeViaMux(
  muxAssetId: string,
  language: string,
): Promise<Omit<RawTranscriptionResult, "resolvedProvider" | "routingReport">> {
  const { track, playbackId, playbackPolicy } = await waitForReadySubtitleTrack(
    muxAssetId,
    language,
  )
  const vttUrl = await buildMuxTextTrackUrl(
    playbackId,
    track.id,
    playbackPolicy,
  )
  const response = await fetch(vttUrl, {
    signal: AbortSignal.timeout(SUBTITLE_FETCH_TIMEOUT_MS),
  })
  if (!response.ok) {
    throw new Error(
      `Failed to fetch subtitle track: ${response.status} ${response.statusText}`,
    )
  }

  const vttContent = await response.text()
  const segments = parseVTT(vttContent)
  const text = segments.map((s) => s.text).join(" ")

  return {
    text,
    segments,
    language: track.language_code ?? language,
  }
}

export function normalizeSourceLanguageCode(language: string): string | null {
  const normalized = language.trim().toLowerCase().split(/[-_]/)[0] ?? null
  if (!normalized || normalized === "auto") {
    return null
  }

  return normalized
}

function failAttemptWithRoutingReport(
  report: TranscriptionRoutingReport | undefined,
  input: {
    requestedProvider: RequestedTranscriptionProvider
    resolvedProvider: ResolvedTranscriptionProvider
    message: string
    sourceLanguageCode?: string
    decisionReason?: string
    cause?: unknown
  },
): never {
  const { report: runningReport, attemptId } = beginAttempt(report, {
    requestedProvider: input.requestedProvider,
    resolvedProvider: input.resolvedProvider,
    sourceLanguageCode: input.sourceLanguageCode,
    decisionReason: input.decisionReason,
  })
  const failedReport = completeAttempt(runningReport, attemptId, {
    status: "failed",
    fallbackReason: input.message,
  })

  throw new TranscriptionExecutionError(
    input.message,
    failedReport,
    input.cause,
  )
}

function buildAttempt(input: {
  requestedProvider: RequestedTranscriptionProvider
  resolvedProvider: ResolvedTranscriptionProvider
  status: TranscriptionAttempt["status"]
  sourceLanguageCode?: string
  decisionReason?: string
  fallbackFromProvider?: "elevenlabs"
  fallbackReason?: string
  startedAt?: string
  finishedAt?: string
  attemptId?: string
}): TranscriptionAttempt {
  return {
    attemptId: input.attemptId ?? randomUUID(),
    requestedProvider: input.requestedProvider,
    resolvedProvider: input.resolvedProvider,
    status: input.status,
    startedAt: input.startedAt ?? new Date().toISOString(),
    ...(input.sourceLanguageCode
      ? { sourceLanguageCode: input.sourceLanguageCode }
      : {}),
    ...(input.decisionReason ? { decisionReason: input.decisionReason } : {}),
    ...(input.fallbackFromProvider
      ? { fallbackFromProvider: input.fallbackFromProvider }
      : {}),
    ...(input.fallbackReason ? { fallbackReason: input.fallbackReason } : {}),
    ...(input.finishedAt ? { finishedAt: input.finishedAt } : {}),
  }
}

function beginAttempt(
  report: TranscriptionRoutingReport | undefined,
  input: {
    requestedProvider: RequestedTranscriptionProvider
    resolvedProvider: ResolvedTranscriptionProvider
    sourceLanguageCode?: string
    decisionReason?: string
  },
): { report: TranscriptionRoutingReport; attemptId: string } {
  const baseReport = report ?? buildInitialTranscriptionRoutingReport()
  const runningAttemptId = baseReport.currentAttemptId
  const existingRunningAttempt =
    runningAttemptId != null
      ? baseReport.attempts.find(
          (attempt) => attempt.attemptId === runningAttemptId,
        )
      : undefined

  if (
    existingRunningAttempt &&
    existingRunningAttempt.status === "running" &&
    existingRunningAttempt.requestedProvider === input.requestedProvider &&
    existingRunningAttempt.resolvedProvider === input.resolvedProvider
  ) {
    return {
      report: updateTranscriptionAttempt(
        baseReport,
        existingRunningAttempt.attemptId,
        (attempt) => ({
          ...attempt,
          ...(input.sourceLanguageCode
            ? { sourceLanguageCode: input.sourceLanguageCode }
            : {}),
          ...(input.decisionReason
            ? { decisionReason: input.decisionReason }
            : {}),
        }),
      ),
      attemptId: existingRunningAttempt.attemptId,
    }
  }

  const attempt = buildAttempt({
    ...input,
    status: "running",
  })

  return {
    report: appendTranscriptionAttempt(baseReport, attempt),
    attemptId: attempt.attemptId,
  }
}

function completeAttempt(
  report: TranscriptionRoutingReport,
  attemptId: string,
  input: {
    status: TranscriptionAttempt["status"]
    fallbackFromProvider?: "elevenlabs"
    fallbackReason?: string
  },
): TranscriptionRoutingReport {
  return {
    ...updateTranscriptionAttempt(report, attemptId, (attempt) => ({
      ...attempt,
      status: input.status,
      finishedAt: new Date().toISOString(),
      ...(input.fallbackFromProvider
        ? { fallbackFromProvider: input.fallbackFromProvider }
        : {}),
      ...(input.fallbackReason ? { fallbackReason: input.fallbackReason } : {}),
    })),
    currentAttemptId: undefined,
  }
}

function withFinalProvider(
  report: TranscriptionRoutingReport,
  input: {
    provider: ResolvedTranscriptionProvider
    language: string
    fallbackReason?: string
    diarization?: TranscriptionDiarizationSummary
  },
): TranscriptionRoutingReport {
  return {
    ...report,
    finalProvider: input.provider,
    finalSourceLanguageCode: input.language,
    fallbackReason: input.fallbackReason,
    ...(input.provider === "elevenlabs" && input.diarization
      ? { diarization: input.diarization }
      : { diarization: undefined }),
  }
}

async function resolveTranscriptionResult(
  muxAssetId: string,
  language: string,
  options?: {
    requestedProvider?: RequestedTranscriptionProvider
    sourceInputUrl?: string
    keyterms?: string[]
    priorRoutingReport?: TranscriptionRoutingReport
  },
): Promise<RawTranscriptionResult> {
  const requestedProvider = options?.requestedProvider ?? "automatic"
  const sourceLanguageCode = normalizeSourceLanguageCode(language)
  const sourceInputUrl =
    options?.sourceInputUrl ?? options?.priorRoutingReport?.sourceInputUrl
  const baseReport: TranscriptionRoutingReport = {
    ...(options?.priorRoutingReport ??
      buildInitialTranscriptionRoutingReport(
        sourceInputUrl ? { sourceInputUrl } : undefined,
      )),
    ...(sourceInputUrl ? { sourceInputUrl } : {}),
  }

  const runMuxDirectly = async (
    decisionReason: string,
  ): Promise<RawTranscriptionResult> => {
    const { report, attemptId } = beginAttempt(baseReport, {
      requestedProvider,
      resolvedProvider: "mux",
      sourceLanguageCode: sourceLanguageCode ?? language,
      decisionReason,
    })
    try {
      if (sourceLanguageCode) {
        await ensureGeneratedSubtitlesForAsset(muxAssetId, sourceLanguageCode)
      }
      const muxResult = await transcribeViaMux(muxAssetId, language)
      const completedReport = withFinalProvider(
        completeAttempt(report, attemptId, {
          status: "completed",
        }),
        {
          provider: "mux",
          language: muxResult.language,
        },
      )

      return {
        ...muxResult,
        resolvedProvider: "mux",
        routingReport: completedReport,
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Mux transcription failed"
      const failedReport = completeAttempt(report, attemptId, {
        status: "failed",
        fallbackReason: message,
      })

      throw new TranscriptionExecutionError(message, failedReport, error)
    }
  }

  if (requestedProvider === "mux") {
    return runMuxDirectly("Operator explicitly requested Mux transcription.")
  }

  if (!sourceInputUrl) {
    if (requestedProvider === "elevenlabs") {
      failAttemptWithRoutingReport(baseReport, {
        requestedProvider,
        resolvedProvider: "elevenlabs",
        sourceLanguageCode: sourceLanguageCode ?? undefined,
        decisionReason:
          "Operator explicitly requested ElevenLabs transcription.",
        message:
          "ElevenLabs transcription requires a persisted source input URL.",
      })
    }

    return runMuxDirectly(
      "No persisted source input URL was available, so automatic routing used Mux.",
    )
  }

  if (!sourceLanguageCode) {
    if (requestedProvider === "elevenlabs") {
      failAttemptWithRoutingReport(baseReport, {
        requestedProvider,
        resolvedProvider: "elevenlabs",
        decisionReason:
          "Operator explicitly requested ElevenLabs transcription.",
        message:
          "ElevenLabs transcription requires a concrete source language code.",
      })
    }

    return runMuxDirectly(
      "Source language was unresolved, so automatic routing used Mux.",
    )
  }

  if (!isSupportedElevenLabsLanguage(sourceLanguageCode)) {
    if (requestedProvider === "elevenlabs") {
      failAttemptWithRoutingReport(baseReport, {
        requestedProvider,
        resolvedProvider: "elevenlabs",
        sourceLanguageCode,
        decisionReason:
          "Operator explicitly requested ElevenLabs transcription.",
        message: `ElevenLabs does not support source language ${sourceLanguageCode}.`,
      })
    }

    return runMuxDirectly(
      "Source language is not supported by ElevenLabs, so automatic routing used Mux.",
    )
  }

  const elevenlabsAttempt = beginAttempt(baseReport, {
    requestedProvider,
    resolvedProvider: "elevenlabs",
    sourceLanguageCode,
    decisionReason:
      requestedProvider === "automatic"
        ? "Automatic routing chose ElevenLabs for the resolved source language."
        : "Operator explicitly requested ElevenLabs transcription.",
  })

  try {
    const elevenlabsResult = await transcribeViaElevenLabs({
      sourceUrl: sourceInputUrl,
      languageCode: sourceLanguageCode,
      keyterms: options?.keyterms,
    })
    const completedReport = withFinalProvider(
      completeAttempt(elevenlabsAttempt.report, elevenlabsAttempt.attemptId, {
        status: "completed",
      }),
      {
        provider: "elevenlabs",
        language: elevenlabsResult.language,
        diarization: elevenlabsResult.diarization,
      },
    )

    return {
      ...elevenlabsResult,
      resolvedProvider: "elevenlabs",
      routingReport: completedReport,
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "ElevenLabs transcription failed"
    const failedReport = completeAttempt(
      elevenlabsAttempt.report,
      elevenlabsAttempt.attemptId,
      {
        status: "failed",
        fallbackReason: message,
      },
    )

    throw new TranscriptionExecutionError(message, failedReport, error)
  }
}
