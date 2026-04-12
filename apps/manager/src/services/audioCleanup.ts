import { spawn } from "node:child_process"
import { env } from "@/config/env"
import { getMuxAsset, getPlaybackUrl } from "@/services/mux"
import { writeArtifact } from "@/services/storage"

const ELEVENLABS_AUDIO_ISOLATION_URL =
  "https://api.elevenlabs.io/v1/audio-isolation"
const DEFAULT_AUDIO_ISOLATION_TIMEOUT_MS = 5 * 60_000
const AUDIO_FILE_NAME = "original-audio.mp3"
const AUDIO_CONTENT_TYPE = "audio/mpeg"

type CommandResult = {
  stdout: Uint8Array
  stderr: string
}

type SpawnedChildProcess = ReturnType<typeof spawn> & {
  on(event: "error", listener: (error: Error & { code?: string }) => void): void
  on(
    event: "close",
    listener: (code: number | null, signal: string | null) => void,
  ): void
}

export type RunCommand = (
  command: string,
  args: string[],
) => Promise<CommandResult>

export type AudioCleanupInput = {
  assetId: string
  sourceVideoUrl: string
}

export type AudioCleanupArtifactKey = "original-audio" | "cleaned-audio"

export type AudioCleanupDependencies = {
  extractSourceAudio?: (sourceVideoUrl: string) => Promise<Uint8Array>
  fetch?: typeof fetch
  runCommand?: RunCommand
  timeoutMs?: number
  elevenLabsApiKey?: string
  writeArtifact?: typeof writeArtifact
}

export type CleanupAudioForReviewInput = {
  assetId: string
  muxAssetId: string
  playbackId?: string
}

export type CleanupAudioForReviewDependencies = AudioCleanupDependencies & {
  getMuxAsset?: typeof getMuxAsset
}

export type AudioCleanupResult = {
  originalAudioArtifactKey: string
  cleanedAudioArtifactKey: string
  artifactKeys: ["original-audio", "cleaned-audio"]
}

export class AudioCleanupError extends Error {
  readonly artifactKeys: AudioCleanupArtifactKey[]

  constructor(message: string, artifactKeys: AudioCleanupArtifactKey[]) {
    super(message)
    this.name = "AudioCleanupError"
    this.artifactKeys = artifactKeys
  }
}

type IsolateAudioResponse = {
  bytes: Uint8Array
  contentType: string
}

function hasENOENT(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error != null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  )
}

function validateElevenLabsApiKey(apiKey: string | undefined): string {
  if (!apiKey || apiKey.trim().length === 0) {
    throw new Error("ELEVENLABS_API_KEY is required for audio cleanup")
  }

  return apiKey.trim()
}

export function isAudioCleanupConfigured(): boolean {
  return Boolean(env.ELEVENLABS_API_KEY?.trim())
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown audio cleanup error"
}

async function defaultRunCommand(
  command: string,
  args: string[],
): Promise<CommandResult> {
  return await new Promise<CommandResult>((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
    }) as SpawnedChildProcess

    const stdoutChunks: Buffer[] = []
    const stderrChunks: Buffer[] = []

    child.stdout?.on("data", (chunk: Buffer) => {
      stdoutChunks.push(Buffer.from(chunk))
    })
    child.stderr?.on("data", (chunk: Buffer) => {
      stderrChunks.push(Buffer.from(chunk))
    })

    child.on("error", (error: Error & { code?: string }) => {
      reject(error)
    })

    child.on("close", (code: number | null, signal: string | null) => {
      if (code === 0) {
        resolve({
          stdout: new Uint8Array(Buffer.concat(stdoutChunks)),
          stderr: Buffer.concat(stderrChunks).toString("utf8"),
        })
        return
      }

      reject(
        new Error(
          `Command ${command} failed with code ${code ?? "unknown"}${signal ? ` (${signal})` : ""}: ${Buffer.concat(stderrChunks).toString("utf8")}`,
        ),
      )
    })
  })
}

async function extractSourceAudioFromVideoUrlInternal(
  sourceVideoUrl: string,
  runCommand: RunCommand,
): Promise<Uint8Array> {
  try {
    const result = await runCommand("ffmpeg", [
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      sourceVideoUrl,
      "-vn",
      "-acodec",
      "libmp3lame",
      "-f",
      "mp3",
      "pipe:1",
    ])
    return result.stdout
  } catch (error) {
    if (hasENOENT(error)) {
      throw new Error(
        "ffmpeg is required to extract original audio for audio_cleanup. Install ffmpeg in the runtime image or inject a source-audio extractor in tests.",
      )
    }

    if (error instanceof Error) {
      throw new Error(
        `Failed to extract original audio for audio_cleanup from ${sourceVideoUrl}: ${error.message}`,
      )
    }

    throw new Error(
      `Failed to extract original audio for audio_cleanup from ${sourceVideoUrl}`,
    )
  }
}

export async function extractSourceAudioFromVideoUrl(
  sourceVideoUrl: string,
  deps: { runCommand?: RunCommand } = {},
): Promise<Uint8Array> {
  return extractSourceAudioFromVideoUrlInternal(
    sourceVideoUrl,
    deps.runCommand ?? defaultRunCommand,
  )
}

async function readResponseBytes(
  response: Response,
): Promise<IsolateAudioResponse> {
  const bytes = new Uint8Array(await response.arrayBuffer())
  const contentType = response.headers.get("content-type") ?? AUDIO_CONTENT_TYPE

  return {
    bytes,
    contentType,
  }
}

async function fetchWithTimeout(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined

  try {
    return await Promise.race([
      fetchImpl(url, {
        ...init,
        signal: controller.signal,
      }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort()
          reject(
            new Error(
              `ElevenLabs audio isolation timed out after ${timeoutMs}ms`,
            ),
          )
        }, timeoutMs)
      }),
    ])
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(
        `ElevenLabs audio isolation timed out after ${timeoutMs}ms`,
      )
    }

    throw error
  } finally {
    if (timer) {
      clearTimeout(timer)
    }
  }
}

async function isolateAudioWithElevenLabs(
  audioBytes: Uint8Array,
  deps: {
    apiKey: string
    fetchImpl?: typeof fetch
    timeoutMs?: number
  },
): Promise<IsolateAudioResponse> {
  const formData = new FormData()
  formData.append(
    "audio",
    new Blob([Buffer.from(audioBytes)], { type: AUDIO_CONTENT_TYPE }),
    AUDIO_FILE_NAME,
  )
  formData.append("file_format", "other")

  const response = await fetchWithTimeout(
    deps.fetchImpl ?? fetch,
    ELEVENLABS_AUDIO_ISOLATION_URL,
    {
      method: "POST",
      headers: {
        "xi-api-key": deps.apiKey,
      },
      body: formData,
    },
    deps.timeoutMs ?? DEFAULT_AUDIO_ISOLATION_TIMEOUT_MS,
  )

  if (!response.ok) {
    const errorBody = await response.text().catch(() => "")
    const suffix = errorBody.trim().length > 0 ? ` - ${errorBody.trim()}` : ""
    throw new Error(
      `ElevenLabs audio isolation failed: ${response.status} ${response.statusText}${suffix}`,
    )
  }

  return readResponseBytes(response)
}

export async function runAudioCleanup(
  input: AudioCleanupInput,
  deps: AudioCleanupDependencies = {},
): Promise<AudioCleanupResult> {
  const artifactKeys: AudioCleanupArtifactKey[] = []

  try {
    const apiKey = validateElevenLabsApiKey(
      deps.elevenLabsApiKey ?? env.ELEVENLABS_API_KEY,
    )
    const extractSourceAudio =
      deps.extractSourceAudio ??
      ((sourceVideoUrl: string) =>
        extractSourceAudioFromVideoUrl(sourceVideoUrl, {
          runCommand: deps.runCommand,
        }))
    const writeArtifactImpl = deps.writeArtifact ?? writeArtifact

    const originalAudioBytes = await extractSourceAudio(input.sourceVideoUrl)
    const originalAudioArtifactKey = await writeArtifactImpl({
      assetId: input.assetId,
      artifactType: "original-audio",
      ext: "mp3",
      body: originalAudioBytes,
      contentType: AUDIO_CONTENT_TYPE,
    })
    artifactKeys.push("original-audio")

    const cleanedAudio = await isolateAudioWithElevenLabs(originalAudioBytes, {
      apiKey,
      fetchImpl: deps.fetch,
      timeoutMs: deps.timeoutMs,
    })

    const cleanedAudioArtifactKey = await writeArtifactImpl({
      assetId: input.assetId,
      artifactType: "cleaned-audio",
      ext: "mp3",
      body: cleanedAudio.bytes,
      contentType: cleanedAudio.contentType,
    })
    artifactKeys.push("cleaned-audio")

    return {
      originalAudioArtifactKey,
      cleanedAudioArtifactKey,
      artifactKeys: ["original-audio", "cleaned-audio"],
    }
  } catch (error) {
    if (error instanceof AudioCleanupError) {
      throw error
    }

    throw new AudioCleanupError(getErrorMessage(error), [...artifactKeys])
  }
}

export async function cleanupAudioForReview(
  input: CleanupAudioForReviewInput,
  deps: CleanupAudioForReviewDependencies = {},
): Promise<AudioCleanupResult> {
  const playbackId =
    input.playbackId ??
    (await (deps.getMuxAsset ?? getMuxAsset)(input.muxAssetId)).playbackId

  return runAudioCleanup(
    {
      assetId: input.assetId,
      sourceVideoUrl: getPlaybackUrl(playbackId),
    },
    deps,
  )
}
