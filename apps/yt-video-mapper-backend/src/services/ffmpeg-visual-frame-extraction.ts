import { spawn } from "node:child_process"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { isIP } from "node:net"
import { env } from "../config/env.js"
import {
  VISUAL_FRAME_FINGERPRINT_HEIGHT,
  VISUAL_FRAME_FINGERPRINT_WIDTH,
  buildVisualFrameFingerprintPayload,
  type VisualFrameFingerprint,
} from "./visual-fingerprint.js"

const DEFAULT_MAX_FRAMES = 12
const DEFAULT_TIMEOUT_MS = 60_000
const DEFAULT_ADAPTIVE_SEEKING_THRESHOLD_MS = 5 * 60 * 1_000
const DEFAULT_PROTOCOL_WHITELIST = "https,tls,tcp,crypto"
const DEFAULT_LOCAL_PROTOCOL_WHITELIST = "file,pipe"

export type FfmpegCommandRunnerInput = {
  command: string
  args: string[]
  timeoutMs: number
}

export type FfmpegCommandResult = {
  stdout: Buffer
  stderr: string
}

export type FfmpegCommandRunner = (
  input: FfmpegCommandRunnerInput,
) => Promise<FfmpegCommandResult>

export type VisualFrameExtractor = {
  extractFromBytes(input: {
    bytes: Buffer
    contentType: string
    durationMilliseconds?: number | null
  }): Promise<VisualFrameFingerprint[]>
  extractFromUrl(input: {
    url: string
    mediaSourceType?: "DOWNLOAD" | "HLS" | "DASH" | "NONE"
    durationMilliseconds?: number | null
  }): Promise<VisualFrameFingerprint[]>
}

export type FfmpegVisualFrameExtractorOptions = {
  runCommand?: FfmpegCommandRunner
  maxFrames?: number
  timeoutMs?: number
  frameWidth?: number
  frameHeight?: number
  protocolWhitelist?: string
  localProtocolWhitelist?: string
  allowedHosts?: Set<string>
  adaptiveSeeking?: boolean
  now?: () => number
}

export class FfmpegVisualFrameExtractionError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = "FfmpegVisualFrameExtractionError"
  }
}

export class FfmpegVisualFrameExtractor implements VisualFrameExtractor {
  private readonly runCommand: FfmpegCommandRunner
  private readonly maxFrames: number
  private readonly timeoutMs: number
  private readonly frameWidth: number
  private readonly frameHeight: number
  private readonly protocolWhitelist: string
  private readonly localProtocolWhitelist: string
  private readonly allowedHosts: Set<string>
  private readonly adaptiveSeeking: boolean
  private readonly now: () => number

  constructor(options: FfmpegVisualFrameExtractorOptions = {}) {
    this.runCommand = options.runCommand ?? defaultFfmpegCommandRunner
    this.maxFrames = options.maxFrames ?? DEFAULT_MAX_FRAMES
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    this.frameWidth = options.frameWidth ?? VISUAL_FRAME_FINGERPRINT_WIDTH
    this.frameHeight = options.frameHeight ?? VISUAL_FRAME_FINGERPRINT_HEIGHT
    this.protocolWhitelist =
      options.protocolWhitelist ?? DEFAULT_PROTOCOL_WHITELIST
    this.localProtocolWhitelist =
      options.localProtocolWhitelist ?? DEFAULT_LOCAL_PROTOCOL_WHITELIST
    this.allowedHosts =
      options.allowedHosts ?? parseAllowedHosts(env.MEDIA_INDEX_ALLOWED_HOSTS)
    this.adaptiveSeeking = options.adaptiveSeeking ?? false
    this.now = options.now ?? (() => performance.now())
  }

  async extractFromBytes({
    bytes,
    durationMilliseconds,
  }: {
    bytes: Buffer
    contentType: string
    durationMilliseconds?: number | null
  }): Promise<VisualFrameFingerprint[]> {
    if (bytes.byteLength === 0) return []

    const directory = await mkdtemp(join(tmpdir(), "yt-mapper-frames-"))
    const inputPath = join(directory, "upload.bin")

    try {
      await writeFile(inputPath, bytes)
      return await this.extractFromSource({
        source: inputPath,
        isRemoteUrl: false,
        durationMilliseconds,
      })
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  }

  async extractFromUrl({
    url,
    mediaSourceType = "DOWNLOAD",
    durationMilliseconds,
  }: {
    url: string
    mediaSourceType?: "DOWNLOAD" | "HLS" | "DASH" | "NONE"
    durationMilliseconds?: number | null
  }): Promise<VisualFrameFingerprint[]> {
    if (mediaSourceType !== "DOWNLOAD") {
      throw new FfmpegVisualFrameExtractionError(
        "media_source_type_unsupported",
        "Visual extraction only supports direct download media URLs until playlist segment validation is available",
      )
    }

    const mediaUrl = assertSafeOfficialMediaUrl(url, this.allowedHosts)

    return await this.extractFromSource({
      source: mediaUrl.href,
      isRemoteUrl: true,
      durationMilliseconds,
    })
  }

  private async extractFromSource({
    source,
    isRemoteUrl,
    durationMilliseconds,
  }: {
    source: string
    isRemoteUrl: boolean
    durationMilliseconds?: number | null
  }): Promise<VisualFrameFingerprint[]> {
    if (this.shouldUseAdaptiveSeeking(durationMilliseconds)) {
      return await this.extractFramesWithInputSeeking({
        source,
        isRemoteUrl,
        durationMilliseconds,
      })
    }

    const args = this.ffmpegArgs({
      source,
      isRemoteUrl,
      durationMilliseconds,
    })
    const result = await this.runCommand({
      command: "ffmpeg",
      args,
      timeoutMs: this.timeoutMs,
    })

    return this.fingerprintsFromRawFrames(result.stdout, durationMilliseconds)
  }

  private shouldUseAdaptiveSeeking(
    durationMilliseconds: number | null | undefined,
  ): durationMilliseconds is number {
    return (
      this.adaptiveSeeking &&
      durationMilliseconds != null &&
      durationMilliseconds >= DEFAULT_ADAPTIVE_SEEKING_THRESHOLD_MS
    )
  }

  private async extractFramesWithInputSeeking({
    source,
    isRemoteUrl,
    durationMilliseconds,
  }: {
    source: string
    isRemoteUrl: boolean
    durationMilliseconds: number
  }): Promise<VisualFrameFingerprint[]> {
    const deadline = this.now() + this.timeoutMs
    const fingerprints: VisualFrameFingerprint[] = []

    for (const offsetMilliseconds of this.frameOffsets(durationMilliseconds)) {
      const remainingTimeMs = Math.floor(deadline - this.now())
      if (remainingTimeMs <= 0) {
        throw new FfmpegVisualFrameExtractionError(
          "ffmpeg_timeout",
          `ffmpeg timed out after ${this.timeoutMs}ms`,
        )
      }

      const result = await this.runCommand({
        command: "ffmpeg",
        args: this.inputSeekFfmpegArgs({
          source,
          isRemoteUrl,
          offsetMilliseconds,
        }),
        timeoutMs: remainingTimeMs,
      })
      const frameBytes = this.frameWidth * this.frameHeight
      if (result.stdout.byteLength !== frameBytes) {
        throw new FfmpegVisualFrameExtractionError(
          "ffmpeg_incomplete_frames",
          `ffmpeg returned ${result.stdout.byteLength} bytes for a ${frameBytes}-byte visual frame`,
        )
      }

      fingerprints.push({
        offsetMilliseconds,
        durationMilliseconds: null,
        payload: buildVisualFrameFingerprintPayload({
          bytes: result.stdout,
          width: this.frameWidth,
          height: this.frameHeight,
        }),
      })
    }

    return fingerprints
  }

  private frameOffsets(durationMilliseconds: number): number[] {
    const offsetStepMilliseconds = durationMilliseconds / this.maxFrames
    return Array.from({ length: this.maxFrames }, (_, index) =>
      Math.round(index * offsetStepMilliseconds),
    )
  }

  private inputSeekFfmpegArgs({
    source,
    isRemoteUrl,
    offsetMilliseconds,
  }: {
    source: string
    isRemoteUrl: boolean
    offsetMilliseconds: number
  }): string[] {
    return [
      "-hide_banner",
      "-loglevel",
      "error",
      "-nostdin",
      "-protocol_whitelist",
      isRemoteUrl ? this.protocolWhitelist : this.localProtocolWhitelist,
      "-ss",
      (offsetMilliseconds / 1_000).toFixed(3),
      "-i",
      source,
      "-vf",
      `scale=${this.frameWidth}:${this.frameHeight},format=gray`,
      "-frames:v",
      "1",
      "-f",
      "rawvideo",
      "pipe:1",
    ]
  }

  private ffmpegArgs({
    source,
    isRemoteUrl,
    durationMilliseconds,
  }: {
    source: string
    isRemoteUrl: boolean
    durationMilliseconds?: number | null
  }): string[] {
    return [
      "-hide_banner",
      "-loglevel",
      "error",
      "-nostdin",
      "-protocol_whitelist",
      isRemoteUrl ? this.protocolWhitelist : this.localProtocolWhitelist,
      "-i",
      source,
      "-vf",
      `fps=${this.frameRate(durationMilliseconds)},scale=${this.frameWidth}:${this.frameHeight},format=gray`,
      "-frames:v",
      String(this.maxFrames),
      "-f",
      "rawvideo",
      "pipe:1",
    ]
  }

  private frameRate(durationMilliseconds: number | null | undefined): string {
    const durationSeconds =
      durationMilliseconds && durationMilliseconds > 0
        ? durationMilliseconds / 1_000
        : null
    const framesPerSecond = durationSeconds
      ? Math.min(30, this.maxFrames / durationSeconds)
      : 1

    return framesPerSecond.toFixed(6)
  }

  private fingerprintsFromRawFrames(
    stdout: Buffer,
    durationMilliseconds: number | null | undefined,
  ): VisualFrameFingerprint[] {
    const frameBytes = this.frameWidth * this.frameHeight
    if (frameBytes <= 0 || stdout.byteLength < frameBytes) return []

    const completeFrameCount = Math.min(
      this.maxFrames,
      Math.floor(stdout.byteLength / frameBytes),
    )
    const offsetStepMilliseconds =
      durationMilliseconds && durationMilliseconds > 0
        ? durationMilliseconds / this.maxFrames
        : 1_000

    return Array.from({ length: completeFrameCount }, (_, index) => {
      const start = index * frameBytes
      const frame = stdout.subarray(start, start + frameBytes)

      return {
        offsetMilliseconds: Math.round(index * offsetStepMilliseconds),
        durationMilliseconds: null,
        payload: buildVisualFrameFingerprintPayload({
          bytes: frame,
          width: this.frameWidth,
          height: this.frameHeight,
        }),
      }
    })
  }
}

export const defaultFfmpegCommandRunner: FfmpegCommandRunner = async ({
  command,
  args,
  timeoutMs,
}) =>
  await new Promise<FfmpegCommandResult>((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
    })
    const stdoutChunks: Buffer[] = []
    const stderrChunks: Buffer[] = []
    let settled = false
    const timeout = setTimeout(() => {
      if (settled) return
      settled = true
      child.kill("SIGKILL")
      reject(
        new FfmpegVisualFrameExtractionError(
          "ffmpeg_timeout",
          `ffmpeg timed out after ${timeoutMs}ms`,
        ),
      )
    }, timeoutMs)

    child.stdout?.on("data", (chunk: Buffer) => {
      stdoutChunks.push(Buffer.from(chunk))
    })

    child.stderr?.on("data", (chunk: Buffer) => {
      stderrChunks.push(Buffer.from(chunk))
    })

    child.on("error", (error: Error & { code?: string }) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      reject(
        error.code === "ENOENT"
          ? new FfmpegVisualFrameExtractionError(
              "ffmpeg_missing",
              "ffmpeg is required for yt-video-mapper visual fingerprint extraction",
            )
          : error,
      )
    })

    child.on("close", (code: number | null) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)

      const stderr = Buffer.concat(stderrChunks).toString("utf8")
      if (code === 0) {
        resolve({
          stdout: Buffer.concat(stdoutChunks),
          stderr,
        })
        return
      }

      reject(
        new FfmpegVisualFrameExtractionError(
          "ffmpeg_failed",
          `ffmpeg failed with code ${code ?? "unknown"}: ${stderr.slice(-1_000)}`,
        ),
      )
    })
  })

function assertSafeOfficialMediaUrl(
  rawUrl: string,
  allowedHosts: Set<string>,
): URL {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    throw new FfmpegVisualFrameExtractionError(
      "media_url_invalid",
      "Official media URL is malformed",
    )
  }

  if (url.protocol !== "https:") {
    throw new FfmpegVisualFrameExtractionError(
      "media_url_invalid_protocol",
      "Official media URL must use HTTPS",
    )
  }

  const hostname = normalizeHostname(url.hostname)
  if (allowedHosts.size > 0 && !allowedHosts.has(hostname)) {
    throw new FfmpegVisualFrameExtractionError(
      "media_url_host_not_allowed",
      "Official media URL host is not allowlisted",
    )
  }

  if (isLocalHostname(hostname) || isPrivateIpHostname(hostname)) {
    throw new FfmpegVisualFrameExtractionError(
      "media_url_private_host",
      "Official media URL host is local or private",
    )
  }

  return url
}

function parseAllowedHosts(value: string | undefined): Set<string> {
  return new Set(
    (value ?? "")
      .split(",")
      .map((host) => host.trim().toLowerCase())
      .filter((host) => host.length > 0),
  )
}

function normalizeHostname(hostname: string): string {
  return hostname.toLowerCase().replace(/^\[/, "").replace(/\]$/, "")
}

function isLocalHostname(hostname: string): boolean {
  return hostname === "localhost" || hostname.endsWith(".localhost")
}

function isPrivateIpHostname(hostname: string): boolean {
  const ipv4Mapped = ipv4FromMappedIpv6(hostname)
  const ipVersion = isIP(ipv4Mapped ?? hostname)
  if (ipVersion === 0) return false
  if (ipVersion === 4) return isPrivateIpv4(ipv4Mapped ?? hostname)

  return (
    hostname === "::" ||
    hostname === "::1" ||
    hostname.startsWith("fc") ||
    hostname.startsWith("fd") ||
    hostname.startsWith("fe80:")
  )
}

function ipv4FromMappedIpv6(hostname: string): string | null {
  const match = hostname.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i)
  if (!match) return null

  const high = Number.parseInt(match[1]!, 16)
  const low = Number.parseInt(match[2]!, 16)
  return `${(high >> 8) & 255}.${high & 255}.${(low >> 8) & 255}.${low & 255}`
}

function isPrivateIpv4(hostname: string): boolean {
  const [first, second] = hostname.split(".").map((part) => Number(part))
  if (first === 10 || first === 127 || first === 0) return true
  if (first === 169 && second === 254) return true
  if (first === 172 && second >= 16 && second <= 31) return true
  if (first === 192 && second === 168) return true
  if (first === 100 && second >= 64 && second <= 127) return true
  if (first >= 224) return true
  return false
}
