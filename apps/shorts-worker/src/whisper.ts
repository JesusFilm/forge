// Whisper transcription wrapper over @remotion/install-whisper-cpp.
// Install + model download happen at Docker BUILD time (see Dockerfile);
// runtime asserts model presence at boot (config/env.ts assertRuntimeEnv).
// The heavy package import stays lazy so unit tests of other modules never
// load it.

import { dirname } from "node:path"
import type { toCaptions } from "@remotion/install-whisper-cpp"
import { env, type Env } from "./config/env.js"
import { WorkerError } from "./errors.js"

// @remotion/captions' Caption shape, anchored to the real package surface
// via toCaptions' return type (the captions package itself is not a direct
// dependency of this app).
export type Caption = ReturnType<typeof toCaptions>["captions"][number]

export const WHISPER_MODEL = "large-v3-turbo" as const

export class WhisperUnavailableError extends WorkerError {
  constructor() {
    super(
      "whisper model/install is not configured (SHORTS_WORKER_WHISPER_MODEL_PATH / SHORTS_WORKER_WHISPER_CPP_DIR)",
      "whisper_unavailable",
      false,
    )
    this.name = "WhisperUnavailableError"
  }
}

export type WhisperRuntimeConfig = {
  modelPath: string
  whisperCppDir: string
  whisperCppVersion: string
}

export function resolveWhisperConfig(
  target: Env = env,
): WhisperRuntimeConfig | null {
  if (
    !target.SHORTS_WORKER_WHISPER_MODEL_PATH ||
    !target.SHORTS_WORKER_WHISPER_CPP_DIR
  ) {
    return null
  }
  return {
    modelPath: target.SHORTS_WORKER_WHISPER_MODEL_PATH,
    whisperCppDir: target.SHORTS_WORKER_WHISPER_CPP_DIR,
    whisperCppVersion: target.SHORTS_WORKER_WHISPER_CPP_VERSION,
  }
}

export type TranscribeClipInput = {
  wavPath: string
  /** Whisper ISO-639-1 code resolved by manager's whisper-language map — never "auto". */
  language: string
  timeoutMs?: number
  onProgress?: (progress: number) => void
}

export type TranscribeClip = (
  input: TranscribeClipInput,
) => Promise<{ captions: Caption[] }>

// Hallucination guard (plan decision 5, MVP): drop whisper segments that
// fail the no-speech / avg-logprob thresholds. The package's typed
// TranscriptionItem surface does NOT declare these fields (whisper.cpp emits
// them in its full-JSON output depending on version), so the check is
// structural: applied only when the fields exist and are numbers. Pure —
// unit-tested on a fixture in whisper.test.ts.
const NO_SPEECH_PROB_THRESHOLD = 0.6
const AVG_LOGPROB_THRESHOLD = -1.0

export function filterHallucinatedSegments<T extends object>(
  segments: readonly T[],
): T[] {
  return segments.filter((segment) => {
    const candidate = segment as {
      no_speech_prob?: unknown
      avg_logprob?: unknown
    }
    if (
      typeof candidate.no_speech_prob === "number" &&
      candidate.no_speech_prob > NO_SPEECH_PROB_THRESHOLD
    ) {
      return false
    }
    if (
      typeof candidate.avg_logprob === "number" &&
      candidate.avg_logprob < AVG_LOGPROB_THRESHOLD
    ) {
      return false
    }
    return true
  })
}

export function createWhisperTranscriber(
  config: WhisperRuntimeConfig,
): TranscribeClip {
  return async ({ wavPath, language, timeoutMs, onProgress }) => {
    const { transcribe, toCaptions } =
      await import("@remotion/install-whisper-cpp")

    const whisperCppOutput = await transcribe({
      inputPath: wavPath,
      whisperPath: config.whisperCppDir,
      whisperCppVersion: config.whisperCppVersion,
      model: WHISPER_MODEL,
      modelFolder: dirname(config.modelPath),
      tokenLevelTimestamps: true,
      // Always explicit, never "auto" (plan decision 5). Manager's
      // whisper-language map guarantees a supported ISO-639-1 code; the
      // package's Language union is wider than we can statically verify here.
      language: language as Parameters<typeof transcribe>[0]["language"],
      printOutput: false,
      signal:
        timeoutMs !== undefined ? AbortSignal.timeout(timeoutMs) : undefined,
      onProgress,
    })

    const transcription = filterHallucinatedSegments(
      whisperCppOutput.transcription,
    )
    const { captions } = toCaptions({
      whisperCppOutput: { ...whisperCppOutput, transcription },
    })
    return { captions }
  }
}
