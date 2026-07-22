// FFmpeg / ffprobe invocation layer. Cloned from apps/crop-worker/src/ffmpeg.ts:
// injectable RunCommand, spawn with stdio ["ignore","pipe","pipe"],
// binary-safe stdout accumulation, utf8 stderr, setTimeout + SIGKILL
// timeout, ENOENT classified into an actionable "binary is required" error.

import { spawn } from "node:child_process"
import { WorkerError } from "./errors.js"

// -protocol_whitelist applied to every ffmpeg/ffprobe input that reads the
// request-supplied source URL (probe + trim). Defeats file:/concat:/data:
// smuggling even if a hostile URL slips past validateSourceUrl. ",http" is
// appended ONLY for the non-production loopback smoke case (plan decision
// 10). Invocations that read worker-generated local temp files (clip probe,
// WAV extraction, output sanity probe) keep ffmpeg's default protocol set —
// do NOT add the restrictive whitelist there.
export function sourceProtocolWhitelist(loopbackHttp: boolean): string {
  const base = "https,tls,tcp,crypto,hls"
  return loopbackHttp ? `${base},http` : base
}

export type CommandResult = {
  stdout: Buffer
  stderr: string
}

export type RunCommandOptions = {
  timeoutMs?: number
  signal?: AbortSignal
  /** Called with each complete stderr line (progress parsing). */
  onStderrLine?: (line: string) => void
}

export type RunCommand = (
  command: string,
  args: string[],
  options?: RunCommandOptions,
) => Promise<CommandResult>

export class CommandTimeoutError extends WorkerError {
  constructor(command: string, timeoutMs: number) {
    super(
      `Command ${command} timed out after ${timeoutMs}ms`,
      "command_timeout",
      true,
    )
    this.name = "CommandTimeoutError"
  }
}

export class CommandCancelledError extends WorkerError {
  constructor(command: string) {
    super(`Command ${command} was cancelled`, "command_cancelled", false)
    this.name = "CommandCancelledError"
  }
}

export class CommandFailedError extends WorkerError {
  constructor(command: string, code: number | null, stderr: string) {
    super(
      `Command ${command} failed with code ${code ?? "unknown"}: ${stderr.slice(-2000)}`,
      "command_failed",
      // Non-zero exits from remote-source reads are often transient HLS
      // hiccups; the manager's bounded resubmit handles the deterministic
      // case (it stops after its budget).
      true,
    )
    this.name = "CommandFailedError"
  }
}

export class MissingBinaryError extends WorkerError {
  constructor(binary: string) {
    super(
      `${binary} is required for shorts-worker. Install ${binary} in the runtime image (apps/shorts-worker/Dockerfile installs ffmpeg, which includes ffprobe) or inject a RunCommand in tests.`,
      "missing_binary",
      false,
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
      if (options.signal) {
        options.signal.removeEventListener("abort", abortListener)
      }
      callback()
    }

    const abortListener = () => {
      finish(() => {
        child.kill("SIGKILL")
        reject(new CommandCancelledError(command))
      })
    }
    if (options.signal?.aborted) {
      abortListener()
      return
    }
    options.signal?.addEventListener("abort", abortListener, { once: true })

    if (timeoutMs !== undefined) {
      timeout = setTimeout(() => {
        finish(() => {
          child.kill("SIGKILL")
          reject(new CommandTimeoutError(command, timeoutMs))
        })
      }, timeoutMs)
    }

    child.stdout?.on("data", (chunk: Buffer) => {
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
  durationSec: number
  fps: number
  hasAudio: boolean
}

export type ProbeMediaDependencies = {
  runCommand?: RunCommand
  timeoutMs?: number
  /** Set ONLY when probing the request-supplied source URL. */
  protocolWhitelist?: string
  signal?: AbortSignal
}

export const DEFAULT_PROBE_TIMEOUT_MS = 120_000

type FfprobeStream = {
  codec_type?: string
  width?: number
  height?: number
  duration?: string
  avg_frame_rate?: string
  r_frame_rate?: string
}

type FfprobeOutput = {
  streams?: FfprobeStream[]
  format?: { duration?: string }
}

function parseFrameRate(value: string | undefined): number | null {
  if (!value) return null
  const [numerator, denominator] = value.split("/").map(Number)
  if (
    !Number.isFinite(numerator) ||
    !Number.isFinite(denominator) ||
    denominator === 0 ||
    numerator === 0
  ) {
    return null
  }
  return numerator! / denominator!
}

export async function probeMedia(
  input: string,
  deps: ProbeMediaDependencies = {},
): Promise<ProbeResult> {
  const runCommand = deps.runCommand ?? defaultRunCommand

  let result: CommandResult
  try {
    result = await runCommand(
      "ffprobe",
      [
        "-v",
        "error",
        ...(deps.protocolWhitelist
          ? ["-protocol_whitelist", deps.protocolWhitelist]
          : []),
        "-print_format",
        "json",
        "-show_streams",
        "-show_format",
        input,
      ],
      {
        timeoutMs: deps.timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS,
        signal: deps.signal,
      },
    )
  } catch (error) {
    throw classifyCommandError(error, "ffprobe")
  }

  let parsed: FfprobeOutput
  try {
    parsed = JSON.parse(result.stdout.toString("utf8")) as FfprobeOutput
  } catch {
    throw new Error(`ffprobe returned unparseable output for ${input}`)
  }

  const videoStream = parsed.streams?.find(
    (stream) => stream.codec_type === "video",
  )
  if (
    !videoStream ||
    typeof videoStream.width !== "number" ||
    typeof videoStream.height !== "number"
  ) {
    throw new Error(
      `ffprobe found no video stream with dimensions for ${input}`,
    )
  }

  const formatDuration = Number(parsed.format?.duration)
  const streamDuration = Number(videoStream.duration)
  const durationSec = Number.isFinite(formatDuration)
    ? formatDuration
    : streamDuration

  if (!Number.isFinite(durationSec) || durationSec <= 0) {
    throw new Error(`ffprobe found no usable duration for ${input}`)
  }

  const fps =
    parseFrameRate(videoStream.avg_frame_rate) ??
    parseFrameRate(videoStream.r_frame_rate) ??
    0

  const hasAudio =
    parsed.streams?.some((stream) => stream.codec_type === "audio") ?? false

  return {
    width: videoStream.width,
    height: videoStream.height,
    durationSec,
    fps,
    hasAudio,
  }
}
