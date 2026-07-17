// Prepare pipeline (plan "shorts-worker" deltas + decision 9):
//   validateSourceUrl → ffprobe source duration → re-clamp caller bounds →
//   ffmpeg INPUT-SEEK trim (-ss before -i; argv order pinned by unit test) →
//   ffprobe clip meta → optional 16kHz WAV + whisper word captions +
//   hallucination filter → artifacts.

import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { env } from "./config/env.js"
import type { JobDeadline } from "./deadline.js"
import {
  classifyCommandError,
  defaultRunCommand,
  DEFAULT_PROBE_TIMEOUT_MS,
  probeMedia,
  sourceProtocolWhitelist,
  type RunCommand,
} from "./ffmpeg.js"
import { WorkerError } from "./errors.js"
import { parseAllowedHosts, validateSourceUrl } from "./source-url.js"
import { createStorage, type Storage } from "./storage.js"
import type {
  ArtifactRef,
  CaptionsArtifact,
  ClipMetaArtifact,
  PrepareReport,
  TranscriptionAnnotation,
} from "./types.js"
import {
  createWhisperTranscriber,
  resolveWhisperConfig,
  WHISPER_MODEL,
  WhisperUnavailableError,
  type TranscribeClip,
} from "./whisper.js"

export const CLIP_ARTIFACT_TYPE = "shorts-clip-v1"
export const CLIP_META_ARTIFACT_TYPE = "shorts-clip-meta-v1"
export const CAPTIONS_ARTIFACT_TYPE = "shorts-captions-v1"

export const TRANSCRIPTION_SKIPPED_NO_AUDIO: TranscriptionAnnotation =
  "transcription_skipped_no_audio"
export const TRANSCRIPTION_UNSUPPORTED_LANGUAGE: TranscriptionAnnotation =
  "transcription_unsupported_language"

export class ClipOutOfRangeError extends WorkerError {
  constructor(message: string) {
    super(message, "clip_out_of_range", false)
    this.name = "ClipOutOfRangeError"
  }
}

// Never trust caller bounds (plan decision 9): clamp against the PROBED
// source duration before building any ffmpeg argv.
export function clampClipBounds({
  startSec,
  endSec,
  sourceDurationSec,
}: {
  startSec: number
  endSec: number
  sourceDurationSec: number
}): { startSec: number; endSec: number } {
  const clampedStart = Math.min(Math.max(0, startSec), sourceDurationSec)
  const clampedEnd = Math.min(Math.max(endSec, 0), sourceDurationSec)
  if (clampedEnd - clampedStart <= 0) {
    throw new ClipOutOfRangeError(
      `clip [${startSec}, ${endSec}] does not overlap the probed source duration ${sourceDurationSec}s`,
    )
  }
  return { startSec: clampedStart, endSec: clampedEnd }
}

// Input-seek trim (REQUIRED): `-ss` BEFORE `-i` so ffmpeg seeks inside the
// HLS input instead of downloading + decoding everything up to the in-point
// (output-seek on a 2h film transfers gigabytes). Explicit stream mapping
// pins ONE video + at-most-one audio stream instead of ffmpeg's
// highest-bandwidth default. Re-encode is an intermediate only (Remotion
// re-encodes at render), hence veryfast/CRF 17.
export function buildTrimArgs({
  sourceUrl,
  startSec,
  durationSec,
  protocolWhitelist,
  outputPath,
}: {
  sourceUrl: string
  startSec: number
  durationSec: number
  protocolWhitelist: string
  outputPath: string
}): string[] {
  return [
    "-y",
    "-protocol_whitelist",
    protocolWhitelist,
    "-ss",
    String(startSec),
    "-i",
    sourceUrl,
    "-t",
    String(durationSec),
    "-map",
    "0:v:0",
    "-map",
    "0:a:0?",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "17",
    "-r",
    "30",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    "-movflags",
    "+faststart",
    outputPath,
  ]
}

// 16kHz mono signed-16 WAV — whisper.cpp's required input shape. Reads a
// worker-generated local file, so no protocol whitelist here.
export function buildWavExtractArgs({
  clipPath,
  wavPath,
}: {
  clipPath: string
  wavPath: string
}): string[] {
  return [
    "-y",
    "-i",
    clipPath,
    "-vn",
    "-ar",
    "16000",
    "-ac",
    "1",
    "-c:a",
    "pcm_s16le",
    wavPath,
  ]
}

export type PrepareProgress = (progress: number, message: string) => void

export type PrepareDependencies = {
  runCommand?: RunCommand
  storage?: Storage
  /** Per-JOB deadline (set at enqueue time); caps every invocation below the remaining budget. */
  deadline?: JobDeadline
  /**
   * Injected transcriber. `undefined` → resolve the default from env;
   * `null` → whisper unavailable (non-production degrades to the
   * unsupported-language annotation, production throws).
   */
  transcribe?: TranscribeClip | null
  allowedHosts?: string[]
  nodeEnv?: string
  ffmpegTimeoutMs?: number
  whisperTimeoutMs?: number
  now?: () => Date
}

export type RunPrepareInput = {
  assetId: string
  sourceUrl: string
  clip: { startSec: number; endSec: number }
  /** Whisper ISO-639-1 code, or null for unsupported languages. */
  language: string | null
  deps?: PrepareDependencies
  onProgress?: PrepareProgress
}

export type RunPrepareResult = {
  artifacts: ArtifactRef[]
  report: PrepareReport
}

export async function runPrepare({
  assetId,
  sourceUrl,
  clip,
  language,
  deps = {},
  onProgress,
}: RunPrepareInput): Promise<RunPrepareResult> {
  const runCommand = deps.runCommand ?? defaultRunCommand
  const storage = deps.storage ?? createStorage()
  const deadline = deps.deadline
  const allowedHosts =
    deps.allowedHosts ??
    parseAllowedHosts(env.SHORTS_WORKER_ALLOWED_SOURCE_HOSTS)
  const nodeEnv = deps.nodeEnv ?? env.NODE_ENV
  const ffmpegTimeoutMs =
    deps.ffmpegTimeoutMs ?? env.SHORTS_WORKER_FFMPEG_TIMEOUT_MS
  const whisperTimeoutMs =
    deps.whisperTimeoutMs ?? env.SHORTS_WORKER_WHISPER_TIMEOUT_MS
  const now = deps.now ?? (() => new Date())

  // Per-invocation timeout = min(per-invocation cap, remaining job budget);
  // throws JobDeadlineExceededError once the job deadline has passed.
  const invocationTimeoutMs = (capMs: number): number =>
    deadline ? deadline.capTimeoutMs(capMs) : capMs

  // SSRF gate — MUST run before any ffmpeg/ffprobe spawn (plan decision 10).
  const validated = validateSourceUrl(
    sourceUrl,
    allowedHosts,
    nodeEnv === "production",
  )
  const protocolWhitelist = sourceProtocolWhitelist(validated.loopbackHttp)
  // Every subprocess receives the RE-SERIALIZED parsed URL — exactly the
  // string that passed validation — never the raw caller-supplied string.
  const canonicalSourceUrl = validated.url.toString()
  onProgress?.(0.02, "Validated source URL")

  const tempDir = await mkdtemp(join(tmpdir(), "shorts-worker-prepare-"))
  try {
    // Probe the source URL (input-seek-friendly: probe the URL itself).
    const source = await probeMedia(canonicalSourceUrl, {
      runCommand,
      timeoutMs: invocationTimeoutMs(DEFAULT_PROBE_TIMEOUT_MS),
      protocolWhitelist,
    })
    onProgress?.(0.1, "Probed source")

    const bounds = clampClipBounds({
      startSec: clip.startSec,
      endSec: clip.endSec,
      sourceDurationSec: source.durationSec,
    })
    const trimDurationSec = bounds.endSec - bounds.startSec

    const clipPath = join(tempDir, "clip.mp4")
    try {
      await runCommand(
        "ffmpeg",
        buildTrimArgs({
          sourceUrl: canonicalSourceUrl,
          startSec: bounds.startSec,
          durationSec: trimDurationSec,
          protocolWhitelist,
          outputPath: clipPath,
        }),
        { timeoutMs: invocationTimeoutMs(ffmpegTimeoutMs) },
      )
    } catch (error) {
      throw classifyCommandError(error, "ffmpeg")
    }
    onProgress?.(0.5, "Trimmed clip")

    // Probe the worker-generated clip (local file — default protocol set).
    const clipProbe = await probeMedia(clipPath, {
      runCommand,
      timeoutMs: invocationTimeoutMs(DEFAULT_PROBE_TIMEOUT_MS),
    })
    onProgress?.(0.55, "Probed clip")

    // Transcription with deterministic degradation (plan decision 5): no
    // audio and unsupported language take the SAME skip path, differing only
    // in the annotation.
    let annotation: TranscriptionAnnotation | null = null
    let captions: CaptionsArtifact["captions"] = []

    if (!clipProbe.hasAudio) {
      annotation = TRANSCRIPTION_SKIPPED_NO_AUDIO
    } else if (language === null) {
      annotation = TRANSCRIPTION_UNSUPPORTED_LANGUAGE
    } else {
      const transcribe =
        deps.transcribe !== undefined ? deps.transcribe : defaultTranscriber()
      if (!transcribe) {
        if (nodeEnv === "production") {
          // assertRuntimeEnv fails boot before this can happen in production;
          // a deterministic throw here is the belt-and-braces.
          throw new WhisperUnavailableError()
        }
        annotation = TRANSCRIPTION_UNSUPPORTED_LANGUAGE
      } else {
        const wavPath = join(tempDir, "clip.wav")
        try {
          await runCommand(
            "ffmpeg",
            buildWavExtractArgs({ clipPath, wavPath }),
            { timeoutMs: invocationTimeoutMs(ffmpegTimeoutMs) },
          )
        } catch (error) {
          throw classifyCommandError(error, "ffmpeg")
        }
        onProgress?.(0.6, "Extracted audio")

        const transcribed = await transcribe({
          wavPath,
          language,
          timeoutMs: invocationTimeoutMs(whisperTimeoutMs),
          onProgress: (progress) => {
            onProgress?.(0.6 + progress * 0.25, "Transcribing")
          },
        })
        captions = transcribed.captions.map((caption) => ({
          text: caption.text,
          startMs: caption.startMs,
          endMs: caption.endMs,
          timestampMs: caption.timestampMs ?? null,
          confidence: caption.confidence ?? null,
        }))
      }
    }
    onProgress?.(0.88, "Captions resolved")

    const generatedAt = now().toISOString()

    // Host-only source provenance — never the full URL (plan decision 12).
    const clipMeta: ClipMetaArtifact = {
      sourceHost: validated.url.hostname,
      clip: { startSec: bounds.startSec, endSec: bounds.endSec },
      durationSec: clipProbe.durationSec,
      fps: clipProbe.fps,
      width: clipProbe.width,
      height: clipProbe.height,
      hasAudio: clipProbe.hasAudio,
      generatedAt,
    }

    // annotation === null implies whisper actually ran (every skip path sets
    // an annotation), so language/model are only recorded for real runs.
    const captionsArtifact: CaptionsArtifact = {
      captions,
      language: annotation === null ? language : null,
      model: annotation === null ? WHISPER_MODEL : null,
      annotation,
      generatedAt,
    }

    await storage.writeArtifactFromFile(
      assetId,
      CLIP_ARTIFACT_TYPE,
      "mp4",
      clipPath,
      "video/mp4",
    )
    await storage.writeArtifact({
      assetId,
      artifactType: CLIP_META_ARTIFACT_TYPE,
      ext: "json",
      body: JSON.stringify(clipMeta, null, 2),
      contentType: "application/json",
    })
    await storage.writeArtifact({
      assetId,
      artifactType: CAPTIONS_ARTIFACT_TYPE,
      ext: "json",
      body: JSON.stringify(captionsArtifact, null, 2),
      contentType: "application/json",
    })
    onProgress?.(0.97, "Uploaded artifacts")

    const artifacts: ArtifactRef[] = [
      { assetId, artifactType: CLIP_ARTIFACT_TYPE, ext: "mp4" },
      { assetId, artifactType: CLIP_META_ARTIFACT_TYPE, ext: "json" },
      { assetId, artifactType: CAPTIONS_ARTIFACT_TYPE, ext: "json" },
    ]

    return {
      artifacts,
      report: {
        hasAudio: clipProbe.hasAudio,
        clipDurationSec: clipProbe.durationSec,
        captionsCount: captions.length,
        annotation,
      },
    }
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
}

function defaultTranscriber(): TranscribeClip | null {
  const config = resolveWhisperConfig()
  return config ? createWhisperTranscriber(config) : null
}
