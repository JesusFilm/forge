// FFmpeg / ffprobe invocation layer.
// Modelled on apps/manager/src/services/audioCleanup.ts: injectable RunCommand,
// spawn with stdio ["ignore","pipe","pipe"], binary-safe stdout accumulation,
// utf8 stderr, setTimeout + SIGKILL timeout, ENOENT classified into an
// actionable "binary is required" error.

import { spawn } from "node:child_process"
import { env } from "./config/env.js"

// -protocol_whitelist applied to every ffmpeg/ffprobe input that reads the
// request-supplied source URL (probe, fingerprint passes, render segments).
// Defeats file:/concat:/data:/http: smuggling even if a hostile URL slips
// past request validation. The concat pass and frame extraction read
// worker-generated local temp files and keep ffmpeg's default protocol set.
// Production allows only the HLS-over-HTTPS chain; outside production "file"
// is added so local-path smokes keep working. Override via
// CROP_WORKER_SOURCE_PROTOCOL_WHITELIST (CSV).
export function sourceProtocolWhitelist(
  override: string | undefined = env.CROP_WORKER_SOURCE_PROTOCOL_WHITELIST,
  nodeEnv: string = env.NODE_ENV,
): string {
  if (override) return override
  const base = "https,tls,tcp,crypto,hls"
  return nodeEnv === "production" ? base : `${base},file`
}

export type CommandResult = {
  stdout: Buffer
  stderr: string
}

export type RunCommandOptions = {
  timeoutMs?: number
  /** Called with each complete stderr line (used for showinfo/progress parsing). */
  onStderrLine?: (line: string) => void
  /**
   * When provided, stdout chunks are streamed to this handler instead of
   * being buffered into the result (result.stdout will be empty). Used for
   * the rawvideo dhash pass where buffering would hold the whole video.
   */
  onStdoutChunk?: (chunk: Buffer) => void
}

export type RunCommand = (
  command: string,
  args: string[],
  options?: RunCommandOptions,
) => Promise<CommandResult>

export class CommandTimeoutError extends Error {
  constructor(command: string, timeoutMs: number) {
    super(`Command ${command} timed out after ${timeoutMs}ms`)
    this.name = "CommandTimeoutError"
  }
}

export class CommandFailedError extends Error {
  constructor(command: string, code: number | null, stderr: string) {
    super(
      `Command ${command} failed with code ${code ?? "unknown"}: ${stderr.slice(-2000)}`,
    )
    this.name = "CommandFailedError"
  }
}

export class MissingBinaryError extends Error {
  constructor(binary: string) {
    super(
      `${binary} is required for crop-worker. Install ${binary} in the runtime image (repo-root nixpacks.toml adds ffmpeg, which includes ffprobe) or inject a RunCommand in tests.`,
    )
    this.name = "MissingBinaryError"
  }
}

function hasENOENT(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error != null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  )
}

export function classifyCommandError(error: unknown, binary: string): Error {
  if (hasENOENT(error)) {
    return new MissingBinaryError(binary)
  }
  return error instanceof Error ? error : new Error(String(error))
}

type SpawnedChildProcess = ReturnType<typeof spawn> & {
  kill(signal?: NodeJS.Signals): boolean
  on(event: "error", listener: (error: Error & { code?: string }) => void): void
  on(
    event: "close",
    listener: (code: number | null, signal: string | null) => void,
  ): void
}

export const defaultRunCommand: RunCommand = async (
  command,
  args,
  options = {},
) => {
  return await new Promise<CommandResult>((resolvePromise, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
    }) as SpawnedChildProcess
    const timeoutMs = options.timeoutMs
    let settled = false
    let timeout: ReturnType<typeof setTimeout> | undefined

    const stdoutChunks: Buffer[] = []
    const stderrChunks: Buffer[] = []
    let stderrPartialLine = ""

    const finish = (callback: () => void) => {
      if (settled) return
      settled = true
      if (timeout) {
        clearTimeout(timeout)
      }
      callback()
    }

    if (timeoutMs !== undefined) {
      timeout = setTimeout(() => {
        finish(() => {
          child.kill("SIGKILL")
          reject(new CommandTimeoutError(command, timeoutMs))
        })
      }, timeoutMs)
    }

    child.stdout?.on("data", (chunk: Buffer) => {
      if (options.onStdoutChunk) {
        options.onStdoutChunk(Buffer.from(chunk))
        return
      }
      stdoutChunks.push(Buffer.from(chunk))
    })

    child.stderr?.on("data", (chunk: Buffer) => {
      stderrChunks.push(Buffer.from(chunk))

      if (options.onStderrLine) {
        const text = stderrPartialLine + chunk.toString("utf8")
        const lines = text.split(/\r?\n/)
        stderrPartialLine = lines.pop() ?? ""
        for (const line of lines) {
          options.onStderrLine(line)
        }
      }
    })

    child.on("error", (error: Error & { code?: string }) => {
      finish(() => reject(error))
    })

    child.on("close", (code: number | null, _signal: string | null) => {
      if (options.onStderrLine && stderrPartialLine.length > 0) {
        options.onStderrLine(stderrPartialLine)
        stderrPartialLine = ""
      }

      const stderr = Buffer.concat(stderrChunks).toString("utf8")

      if (code === 0) {
        finish(() => {
          resolvePromise({
            stdout: Buffer.concat(stdoutChunks),
            stderr,
          })
        })
        return
      }

      finish(() => {
        reject(new CommandFailedError(command, code, stderr))
      })
    })
  })
}

// ---------------------------------------------------------------------------
// ffprobe
// ---------------------------------------------------------------------------

export type ProbeResult = {
  width: number
  height: number
  durationSeconds: number
}

export type ProbeSourceDependencies = {
  runCommand?: RunCommand
  timeoutMs?: number
  protocolWhitelist?: string
}

export const DEFAULT_PROBE_TIMEOUT_MS = 120_000

type FfprobeStream = {
  codec_type?: string
  width?: number
  height?: number
  duration?: string
}

type FfprobeOutput = {
  streams?: FfprobeStream[]
  format?: { duration?: string }
}

export async function probeSource(
  url: string,
  deps: ProbeSourceDependencies = {},
): Promise<ProbeResult> {
  const runCommand = deps.runCommand ?? defaultRunCommand
  const protocolWhitelist = deps.protocolWhitelist ?? sourceProtocolWhitelist()

  let result: CommandResult
  try {
    result = await runCommand(
      "ffprobe",
      [
        "-v",
        "error",
        "-protocol_whitelist",
        protocolWhitelist,
        "-print_format",
        "json",
        "-show_streams",
        "-show_format",
        url,
      ],
      { timeoutMs: deps.timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS },
    )
  } catch (error) {
    throw classifyCommandError(error, "ffprobe")
  }

  let parsed: FfprobeOutput
  try {
    parsed = JSON.parse(result.stdout.toString("utf8")) as FfprobeOutput
  } catch {
    throw new Error(`ffprobe returned unparseable output for ${url}`)
  }

  const videoStream = parsed.streams?.find(
    (stream) => stream.codec_type === "video",
  )
  if (
    !videoStream ||
    typeof videoStream.width !== "number" ||
    typeof videoStream.height !== "number"
  ) {
    throw new Error(`ffprobe found no video stream with dimensions for ${url}`)
  }

  const formatDuration = Number(parsed.format?.duration)
  const streamDuration = Number(videoStream.duration)
  const durationSeconds = Number.isFinite(formatDuration)
    ? formatDuration
    : streamDuration

  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new Error(`ffprobe found no usable duration for ${url}`)
  }

  return {
    width: videoStream.width,
    height: videoStream.height,
    durationSeconds,
  }
}
