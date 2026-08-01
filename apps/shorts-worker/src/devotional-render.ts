// Bounded devotional media preparation + dual-aspect Remotion rendering.
// Mastra owns durable Workspace inputs/outputs. The worker owns Arclight lookup,
// source download, ffmpeg preparation, Chromium, and streamed transfer through
// short-lived signed capabilities.

import { createHash } from "node:crypto"
import { createReadStream, createWriteStream } from "node:fs"
import { copyFile, cp, mkdir, mkdtemp, readdir, rm } from "node:fs/promises"
import { once } from "node:events"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { Readable } from "node:stream"
import { fileURLToPath } from "node:url"
import { z } from "zod"
import {
  devotionalWorkspaceArtifactRefSchema,
  devotionalWorkspaceManifestSchema,
} from "@forge/devotional-workspace"
import { devotionalRenderConfigSchema } from "@forge/shorts-compositions/devotional/styles"
import { env } from "./config/env.js"
import { JobDeadlineExceededError, type JobDeadline } from "./deadline.js"
import { WorkerError } from "./errors.js"
import {
  downloadDevotionalWorkspaceGrant,
  readDevotionalWorkspaceGrant,
  uploadDevotionalWorkspaceGrant,
  type DevotionalWorkspaceTransfer,
} from "./devotional-transfer.js"
import {
  DEFAULT_PROBE_TIMEOUT_MS,
  defaultRunCommand,
  probeMedia,
  type RunCommand,
} from "./ffmpeg.js"
import { createDefaultRenderEngine, type RenderEngine } from "./render.js"
import { validateSourceUrl } from "./source-url.js"
import {
  artifactKey,
  createDevotionalStorage,
  devotionalAttemptToken,
  devotionalManifestKey,
  devotionalManifestRefFromAssetId,
  devotionalWorkspaceAssetId,
  devotionalWorkspaceKey,
  type DevotionalAttemptIdentity,
  type Storage,
  type WorkspaceArtifactRef,
} from "./storage.js"
import type {
  ArtifactRef,
  DevotionalRenderMetaArtifact,
  DevotionalRenderOutput,
  DevotionalRenderReport,
} from "./types.js"

export const DEVOTIONAL_INPUT_ARTIFACT_TYPE = "devotional-render-input-v1"
export const DEVOTIONAL_MUSIC_ARTIFACT_TYPE = "devotional-music-v1"
export const DEVOTIONAL_PORTRAIT_ARTIFACT_TYPE = "devotional-output-portrait-v1"
export const DEVOTIONAL_WIDE_ARTIFACT_TYPE = "devotional-output-wide-v1"
export const DEVOTIONAL_RENDER_META_ARTIFACT_TYPE = "devotional-render-meta-v1"

const SAFE_SEGMENT_ID = /^[a-zA-Z0-9_-]+$/
const DEVOTIONAL_COMPOSITION_ID = "devotional"
const DEVOTIONAL_WIDE_COMPOSITION_ID = "devotional-wide"
const DEVOTIONAL_WIDTH = 1080
const DEVOTIONAL_HEIGHT = 1920
const DEVOTIONAL_WIDE_WIDTH = 1920
const DEVOTIONAL_WIDE_HEIGHT = 1080
const DELAY_RENDER_TIMEOUT_MS = 120_000
const OFFTHREAD_VIDEO_CACHE_BYTES = 1024 * 1024 * 1024
const OUTPUT_DURATION_TOLERANCE_SEC = 0.5
const SOURCE_DOWNLOAD_MAX_BYTES = 600 * 1024 * 1024
const NARRATION_DOWNLOAD_MAX_BYTES = 25 * 1024 * 1024
const MUSIC_DOWNLOAD_MAX_BYTES = 40 * 1024 * 1024
const ARCLIGHT_METADATA_MAX_BYTES = 256 * 1024
const ARCLIGHT_METADATA_TIMEOUT_MS = 15_000
const SOURCE_DOWNLOAD_TIMEOUT_MS = 120_000
const CARD_TAIL_SEC = 0.4
const INTRO_HOLD_SEC = 1
const OUTRO_HOLD_SEC = 8
const BACKGROUND_SAFETY_MARGIN_SEC = 3
const VIDEO_SPEED = 1.12
const SOURCE_TRAILER_SEC = 8

const workspaceRefSchema = devotionalWorkspaceArtifactRefSchema

const workspaceManifestSchema = devotionalWorkspaceManifestSchema.extend({
  report: z
    .object({
      portrait: z.object({
        outputDurationSec: z.number().positive(),
        width: z.number().int().positive(),
        height: z.number().int().positive(),
      }),
      wide: z.object({
        outputDurationSec: z.number().positive(),
        width: z.number().int().positive(),
        height: z.number().int().positive(),
      }),
    })
    .optional(),
})

const devotionalCardInputSchema = z.object({
  kind: z.enum([
    "cover",
    "scripture",
    "video",
    "reflection-full",
    "reflection-focus",
    "conclusion",
    "questions",
    "cta",
  ]),
  narrationId: z.string().regex(SAFE_SEGMENT_ID).max(64).optional(),
  holdSec: z.number().nonnegative().optional(),
  sectionLabel: z.string().max(128).optional(),
  title: z.string().max(1024).optional(),
  verse: z.string().max(6000).optional(),
  citation: z.string().max(256).optional(),
  paragraphs: z.array(z.string().max(4000)).max(20).optional(),
  closing: z.string().max(4000).optional(),
  text: z.string().max(4000).optional(),
  highlight: z.string().max(512).optional(),
  questions: z.array(z.string().max(1024)).max(10).optional(),
  prayer: z.string().max(4000).optional(),
  ctaHeadline: z.string().max(512).optional(),
  ctaHandle: z.string().max(256).optional(),
  ctaUrl: z.string().max(1024).optional(),
})

export const devotionalRenderInputSchema = z.object({
  schemaVersion: z.literal("1"),
  renderConfig: devotionalRenderConfigSchema,
  headerDate: z.string().min(1).max(128),
  attribution: z.string().max(512).optional(),
  media: z.object({
    mediaId: z.string().regex(SAFE_SEGMENT_ID).max(128),
    /** Test/dev override. Production callers should submit only mediaId. */
    sourceUrl: z.string().url().optional(),
    clipStartSec: z.number().nonnegative(),
    clipLengthSec: z.number().positive().max(600),
    videoCardSec: z.number().positive().max(600).optional(),
    sourceMediaRef: workspaceRefSchema.optional(),
  }),
  cards: z
    .array(devotionalCardInputSchema)
    .min(1)
    .max(30)
    .refine(
      (cards) => cards.filter((card) => card.kind === "video").length === 1,
      "exactly one video card is required",
    ),
  music: z.boolean().default(false),
  render: z
    .object({
      style: z
        .enum(["grain", "tealorange", "splittone", "teal", "sepia"])
        .default("grain"),
      layout: z
        .enum([
          "centered",
          "editorial",
          "classic",
          "grounded",
          "grounded-panel",
        ])
        .default("grounded"),
      musicVolume: z.number().min(0).max(1).default(0.12),
      xfadeSec: z.number().nonnegative().max(10).default(1.2),
      videoAudioLevel: z.number().min(0).max(1).default(0.55),
    })
    .default({
      style: "grain",
      layout: "grounded",
      musicVolume: 0.12,
      xfadeSec: 1.2,
      videoAudioLevel: 0.55,
    }),
})

export type DevotionalRenderInput = z.infer<typeof devotionalRenderInputSchema>

export function devotionalNarrationArtifactType(segmentId: string): string {
  if (!SAFE_SEGMENT_ID.test(segmentId) || segmentId.length > 64) {
    throw new DevotionalInputError(`invalid narration segment id: ${segmentId}`)
  }
  return `devotional-narration-${segmentId}-v1`
}

export class DevotionalInputError extends WorkerError {
  constructor(message: string) {
    super(message, "devotional_input_invalid", false)
    this.name = "DevotionalInputError"
  }
}

export class DevotionalOutputError extends WorkerError {
  constructor(message: string) {
    super(message, "output_sanity_failed", false)
    this.name = "DevotionalOutputError"
  }
}

export class DevotionalRenderCancelledError extends WorkerError {
  constructor() {
    super("devotional render cancelled", "job_cancelled", false)
    this.name = "DevotionalRenderCancelledError"
  }
}

export type DevotionalRenderProgress = (
  progress: number,
  message: string,
) => void

type Fetch = typeof fetch

export type DevotionalRenderDependencies = {
  storage?: Storage
  engine?: RenderEngine
  runCommand?: RunCommand
  fetchImpl?: Fetch
  deadline?: JobDeadline
  allowedHosts?: string[]
  nodeEnv?: string
  bundleDir?: string | undefined
  concurrency?: number
  now?: () => Date
  signal?: AbortSignal
}

export type RunDevotionalRenderInput = {
  runId: string
  inputAssetId: string
  outputAssetId: string
  inputHash: string
  workspaceTransfer?: DevotionalWorkspaceTransfer
  deps?: DevotionalRenderDependencies
  onProgress?: DevotionalRenderProgress
}

export type RunDevotionalRenderResult = {
  artifacts: ArtifactRef[]
  report: DevotionalRenderReport
}

async function fileDigest(filePath: string): Promise<{
  digest: string
  size: number
}> {
  const hash = createHash("sha256")
  let size = 0
  for await (const chunk of createReadStream(filePath)) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    hash.update(bytes)
    size += bytes.byteLength
  }
  return { digest: hash.digest("hex"), size }
}

function timeoutMs(deadline: JobDeadline | undefined, cap: number): number {
  return deadline ? deadline.capTimeoutMs(cap) : cap
}

async function withDeadline<T>(
  promise: Promise<T>,
  deadline: JobDeadline | undefined,
  signal?: AbortSignal,
): Promise<T> {
  if (signal?.aborted) throw new DevotionalRenderCancelledError()
  if (!deadline && !signal) return promise
  const remainingMs = deadline?.capTimeoutMs(Number.MAX_SAFE_INTEGER)
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    if (remainingMs !== undefined && deadline) {
      timer = setTimeout(
        () => reject(new JobDeadlineExceededError(deadline.elapsedMs())),
        remainingMs,
      )
    }
  })
  let cancelListener: (() => void) | undefined
  const cancelled = new Promise<never>((_, reject) => {
    if (!signal) return
    cancelListener = () => reject(new DevotionalRenderCancelledError())
    signal.addEventListener("abort", cancelListener, { once: true })
  })
  try {
    return await Promise.race([promise, timeout, cancelled])
  } finally {
    clearTimeout(timer)
    if (signal && cancelListener) {
      signal.removeEventListener("abort", cancelListener)
    }
  }
}

function requestSignal(timeout: number, signal?: AbortSignal): AbortSignal {
  const timeoutSignal = AbortSignal.timeout(timeout)
  return signal ? AbortSignal.any([timeoutSignal, signal]) : timeoutSignal
}

async function readResponseCapped(
  response: Response,
  maxBytes: number,
): Promise<Uint8Array> {
  if (!response.body) throw new DevotionalInputError("upstream body is empty")
  const chunks: Uint8Array[] = []
  let total = 0
  for await (const chunk of Readable.fromWeb(
    response.body as Parameters<typeof Readable.fromWeb>[0],
  )) {
    const bytes = Buffer.from(chunk as Uint8Array)
    total += bytes.byteLength
    if (total > maxBytes) {
      throw new DevotionalInputError(
        `upstream body exceeds ${maxBytes}-byte cap`,
      )
    }
    chunks.push(bytes)
  }
  return Buffer.concat(chunks)
}

export async function resolveArclightSourceUrl(
  mediaId: string,
  fetchImpl: Fetch,
  deadline?: JobDeadline,
  signal?: AbortSignal,
): Promise<string> {
  let response: Response
  try {
    response = await fetchImpl(
      `https://api.arclight.org/v2/media-components/${encodeURIComponent(mediaId)}/languages/529?platform=web`,
      {
        redirect: "error",
        signal: requestSignal(
          timeoutMs(deadline, ARCLIGHT_METADATA_TIMEOUT_MS),
          signal,
        ),
      },
    )
  } catch (error) {
    if (signal?.aborted) throw new DevotionalRenderCancelledError()
    throw new WorkerError(
      `Arclight metadata request failed: ${error instanceof Error ? error.message : String(error)}`,
      "upstream_failed",
      true,
    )
  }
  if (!response.ok) {
    throw new WorkerError(
      `Arclight metadata request failed with HTTP ${response.status}`,
      "upstream_failed",
      true,
    )
  }
  let bytes: Uint8Array
  try {
    bytes = await readResponseCapped(response, ARCLIGHT_METADATA_MAX_BYTES)
  } catch (error) {
    if (error instanceof WorkerError) throw error
    if (signal?.aborted) throw new DevotionalRenderCancelledError()
    throw new WorkerError(
      `Arclight metadata body failed: ${error instanceof Error ? error.message : String(error)}`,
      "upstream_failed",
      true,
    )
  }
  let payload: unknown
  try {
    payload = JSON.parse(Buffer.from(bytes).toString("utf8"))
  } catch {
    throw new DevotionalInputError("Arclight metadata was not valid JSON")
  }
  const parsed = z
    .object({
      downloadUrls: z
        .record(z.string(), z.object({ url: z.string().min(1) }))
        .optional(),
    })
    .safeParse(payload)
  const url =
    parsed.success && parsed.data.downloadUrls
      ? (parsed.data.downloadUrls.high?.url ??
        parsed.data.downloadUrls.low?.url)
      : undefined
  if (!url) throw new DevotionalInputError("Arclight returned no download URL")
  return url
}

async function downloadSource(
  rawUrl: string,
  destination: string,
  options: {
    fetchImpl: Fetch
    allowedHosts: string[]
    nodeEnv: string
    deadline?: JobDeadline
    signal?: AbortSignal
  },
): Promise<void> {
  let current = validateSourceUrl(
    rawUrl,
    options.allowedHosts,
    options.nodeEnv === "production",
  ).url
  let response: Response | undefined
  for (let redirects = 0; redirects <= 3; redirects += 1) {
    try {
      response = await options.fetchImpl(current, {
        redirect: "manual",
        signal: requestSignal(
          timeoutMs(options.deadline, SOURCE_DOWNLOAD_TIMEOUT_MS),
          options.signal,
        ),
      })
    } catch (error) {
      if (options.signal?.aborted) throw new DevotionalRenderCancelledError()
      throw new WorkerError(
        `source download failed: ${error instanceof Error ? error.message : String(error)}`,
        "upstream_failed",
        true,
      )
    }
    if (response.status < 300 || response.status >= 400) break
    const location = response.headers.get("location")
    if (!location || redirects === 3) {
      throw new WorkerError(
        "source download exceeded the redirect limit",
        "upstream_failed",
        true,
      )
    }
    await response.body?.cancel().catch(() => {})
    current = validateSourceUrl(
      new URL(location, current).toString(),
      options.allowedHosts,
      options.nodeEnv === "production",
    ).url
  }
  if (!response?.ok || !response.body) {
    throw new WorkerError(
      `source download failed with HTTP ${response?.status ?? "unknown"}`,
      "upstream_failed",
      true,
    )
  }
  const declared = Number(response.headers.get("content-length"))
  if (Number.isFinite(declared) && declared > SOURCE_DOWNLOAD_MAX_BYTES) {
    throw new DevotionalInputError(
      `source content-length exceeds ${SOURCE_DOWNLOAD_MAX_BYTES}-byte cap`,
    )
  }
  const output = createWriteStream(destination)
  let received = 0
  try {
    for await (const chunk of Readable.fromWeb(
      response.body as Parameters<typeof Readable.fromWeb>[0],
    )) {
      const bytes = Buffer.from(chunk as Uint8Array)
      received += bytes.byteLength
      if (received > SOURCE_DOWNLOAD_MAX_BYTES) {
        throw new DevotionalInputError(
          `source download exceeds ${SOURCE_DOWNLOAD_MAX_BYTES}-byte cap`,
        )
      }
      if (!output.write(bytes)) await once(output, "drain")
    }
    output.end()
    await once(output, "finish")
  } catch (error) {
    output.destroy()
    await rm(destination, { force: true }).catch(() => {})
    if (error instanceof WorkerError) throw error
    if (options.signal?.aborted) throw new DevotionalRenderCancelledError()
    throw new WorkerError(
      `source response body failed: ${error instanceof Error ? error.message : String(error)}`,
      "upstream_failed",
      true,
    )
  }
}

async function probeDuration(
  file: string,
  runCommand: RunCommand,
  deadline?: JobDeadline,
  signal?: AbortSignal,
): Promise<number> {
  const result = await runCommand(
    "ffprobe",
    [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=nw=1:nk=1",
      file,
    ],
    {
      timeoutMs: timeoutMs(deadline, DEFAULT_PROBE_TIMEOUT_MS),
      signal,
    },
  )
  const duration = Number.parseFloat(result.stdout.toString("utf8").trim())
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new DevotionalInputError(`audio has no usable duration: ${file}`)
  }
  return duration
}

async function trimVideo(
  source: string,
  destination: string,
  options: {
    startSec: number
    lengthSec: number
    speed?: number
    normalize?: boolean
    withoutAudio?: boolean
    runCommand: RunCommand
    deadline?: JobDeadline
    signal?: AbortSignal
  },
): Promise<void> {
  const args = [
    "-y",
    "-ss",
    String(options.startSec),
    "-t",
    String(options.lengthSec),
    "-i",
    source,
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
  ]
  if (options.speed && options.speed !== 1) {
    args.push("-vf", `setpts=PTS/${options.speed}`)
  }
  if (options.withoutAudio) {
    args.push("-an")
  } else {
    const filters: string[] = []
    if (options.speed && options.speed !== 1) {
      filters.push(`atempo=${options.speed}`)
    }
    if (options.normalize) filters.push("loudnorm=I=-18:TP=-2:LRA=11")
    if (filters.length > 0) args.push("-af", filters.join(","))
    args.push("-c:a", "aac")
  }
  args.push("-movflags", "+faststart", destination)
  await options.runCommand("ffmpeg", args, {
    timeoutMs: timeoutMs(options.deadline, env.SHORTS_WORKER_FFMPEG_TIMEOUT_MS),
    signal: options.signal,
  })
}

function backgroundTimelineSec(cards: Array<Record<string, unknown>>): number {
  return cards.reduce(
    (sum, card) => {
      if (card.kind === "video") return sum
      return (
        sum +
        (typeof card.durationSec === "number" ? card.durationSec : 3) +
        (typeof card.holdSec === "number" ? card.holdSec : 0) +
        CARD_TAIL_SEC
      )
    },
    INTRO_HOLD_SEC + OUTRO_HOLD_SEC + BACKGROUND_SAFETY_MARGIN_SEC,
  )
}

function resolveDevotionalEntryPoint(): string {
  let schemaPath: string
  try {
    schemaPath = fileURLToPath(
      import.meta.resolve("@forge/shorts-compositions/schema"),
    )
  } catch {
    schemaPath = createRequire(import.meta.url).resolve(
      "@forge/shorts-compositions/schema",
    )
  }
  return join(dirname(schemaPath), "devotional", "entry.ts")
}

async function prepareServeUrl(
  engine: RenderEngine,
  bundleDir: string | undefined,
  publicDir: string,
  serveDir: string,
): Promise<string> {
  if (!bundleDir) {
    return engine.bundle({
      entryPoint: resolveDevotionalEntryPoint(),
      publicDir,
      outDir: serveDir,
    })
  }
  await cp(bundleDir, serveDir, { recursive: true })
  for (const file of await readdir(publicDir)) {
    await copyFile(join(publicDir, file), join(serveDir, file))
  }
  return serveDir
}

async function renderAspect(options: {
  aspect: "portrait" | "wide"
  outputAssetId: string
  engine: RenderEngine
  browser: Awaited<ReturnType<RenderEngine["openBrowser"]>>
  serveUrl: string
  inputProps: Record<string, unknown>
  outputPath: string
  concurrency: number
  deadline?: JobDeadline
  onProgress?: DevotionalRenderProgress
  signal?: AbortSignal
}): Promise<DevotionalRenderOutput> {
  const isWide = options.aspect === "wide"
  const composition = await withDeadline(
    options.engine.selectComposition({
      serveUrl: options.serveUrl,
      id: isWide ? DEVOTIONAL_WIDE_COMPOSITION_ID : DEVOTIONAL_COMPOSITION_ID,
      inputProps: options.inputProps,
      puppeteerInstance: options.browser,
      timeoutInMilliseconds: DELAY_RENDER_TIMEOUT_MS,
    }),
    options.deadline,
    options.signal,
  )
  const expectedWidth = isWide ? DEVOTIONAL_WIDE_WIDTH : DEVOTIONAL_WIDTH
  const expectedHeight = isWide ? DEVOTIONAL_WIDE_HEIGHT : DEVOTIONAL_HEIGHT
  if (
    composition.width !== expectedWidth ||
    composition.height !== expectedHeight
  ) {
    throw new DevotionalOutputError(
      `${options.aspect} composition is ${composition.width}x${composition.height}, expected ${expectedWidth}x${expectedHeight}`,
    )
  }
  let lastReported = -1
  await withDeadline(
    options.engine.renderMedia({
      composition,
      serveUrl: options.serveUrl,
      codec: "h264",
      outputLocation: options.outputPath,
      inputProps: options.inputProps,
      puppeteerInstance: options.browser,
      concurrency: options.concurrency,
      offthreadVideoCacheSizeInBytes: OFFTHREAD_VIDEO_CACHE_BYTES,
      timeoutInMilliseconds: DELAY_RENDER_TIMEOUT_MS,
      onProgress: ({ progress }) => {
        if (progress - lastReported >= 0.05 || progress >= 1) {
          lastReported = progress
          const base = isWide ? 0.55 : 0.2
          options.onProgress?.(
            base + progress * 0.3,
            `Rendering ${options.aspect} ${Math.round(progress * 100)}%`,
          )
        }
      },
    }),
    options.deadline,
    options.signal,
  )
  const expectedDuration = composition.durationInFrames / composition.fps
  return {
    artifact: {
      assetId: options.outputAssetId,
      artifactType: isWide
        ? DEVOTIONAL_WIDE_ARTIFACT_TYPE
        : DEVOTIONAL_PORTRAIT_ARTIFACT_TYPE,
      ext: "mp4",
    },
    outputDurationSec: expectedDuration,
    width: expectedWidth,
    height: expectedHeight,
  }
}

export async function runDevotionalRender({
  runId,
  inputAssetId,
  outputAssetId,
  inputHash,
  workspaceTransfer,
  deps = {},
  onProgress,
}: RunDevotionalRenderInput): Promise<RunDevotionalRenderResult> {
  const storage = deps.storage ?? createDevotionalStorage()
  const engine = deps.engine ?? createDefaultRenderEngine()
  const runCommand = deps.runCommand ?? defaultRunCommand
  const fetchImpl = deps.fetchImpl ?? fetch
  const deadline = deps.deadline
  const allowedHosts = deps.allowedHosts ?? ["stream.mux.com"]
  const nodeEnv = deps.nodeEnv ?? env.NODE_ENV
  const bundleDir =
    deps.bundleDir !== undefined
      ? deps.bundleDir
      : env.SHORTS_WORKER_DEVOTIONAL_BUNDLE_DIR
  const concurrency = deps.concurrency ?? env.SHORTS_WORKER_RENDER_CONCURRENCY
  const now = deps.now ?? (() => new Date())
  const signal = deps.signal
  const tempDir = await mkdtemp(join(tmpdir(), "shorts-worker-devotional-"))
  const publicDir = join(tempDir, "public")
  const serveDir = join(tempDir, "bundle")
  const written: ArtifactRef[] = []
  let workspaceManifest: z.infer<typeof workspaceManifestSchema> | undefined
  let browser: Awaited<ReturnType<RenderEngine["openBrowser"]>> | undefined
  try {
    await mkdir(publicDir, { recursive: true })
    onProgress?.(0.01, "Loading devotional render input")
    const inputManifestRef = devotionalManifestRefFromAssetId(inputAssetId)
    let raw: Uint8Array
    if (workspaceTransfer) {
      const manifestBytes = await readDevotionalWorkspaceGrant({
        grant: workspaceTransfer.manifest,
        maxBytes: 1_000_000,
        fetchImpl,
        signal,
        nodeEnv,
      })
      let manifestPayload: unknown
      try {
        manifestPayload = JSON.parse(manifestBytes.toString("utf8"))
      } catch {
        throw new DevotionalInputError("devotional input manifest is not JSON")
      }
      const parsedManifest = workspaceManifestSchema.safeParse(manifestPayload)
      if (
        !parsedManifest.success ||
        parsedManifest.data.kind !== "run-input" ||
        parsedManifest.data.attempt.workspaceGeneration !==
          workspaceTransfer.attempt.workspaceGeneration ||
        parsedManifest.data.attempt.attemptId !==
          workspaceTransfer.attempt.attemptId ||
        parsedManifest.data.attempt.runId !== workspaceTransfer.attempt.runId ||
        inputManifestRef?.key !== workspaceTransfer.manifest.ref.key ||
        parsedManifest.data.artifacts.length !== workspaceTransfer.inputs.length
      ) {
        throw new DevotionalInputError("devotional input manifest is invalid")
      }
      for (const artifact of parsedManifest.data.artifacts) {
        const grant = workspaceTransfer.inputs.find(
          (entry) =>
            entry.artifactType === artifact.artifactType &&
            entry.ext === artifact.ext,
        )
        if (
          !grant ||
          grant.ref.key !== artifact.ref.key ||
          grant.ref.digest !== artifact.ref.digest ||
          grant.ref.size !== artifact.ref.size ||
          grant.ref.contentType !== artifact.ref.contentType ||
          grant.ref.attempt.workspaceGeneration !==
            artifact.ref.attempt.workspaceGeneration ||
          grant.ref.attempt.attemptId !== artifact.ref.attempt.attemptId ||
          grant.ref.attempt.runId !== artifact.ref.attempt.runId
        ) {
          throw new DevotionalInputError(
            `signed transfer omits ${artifact.artifactType}`,
          )
        }
      }
      workspaceManifest = parsedManifest.data
      const specGrant = workspaceTransfer.inputs.find(
        (entry) =>
          entry.artifactType === DEVOTIONAL_INPUT_ARTIFACT_TYPE &&
          entry.ext === "json",
      )
      if (!specGrant) {
        throw new DevotionalInputError(
          "signed transfer omits the devotional render input",
        )
      }
      raw = await readDevotionalWorkspaceGrant({
        grant: specGrant,
        maxBytes: 1_000_000,
        fetchImpl,
        signal,
        nodeEnv,
      })
    } else if (inputManifestRef?.key.includes("/run-input/")) {
      const manifestBytes =
        await storage.readWorkspaceArtifact(inputManifestRef)
      let manifestPayload: unknown
      try {
        manifestPayload = JSON.parse(
          Buffer.from(manifestBytes).toString("utf8"),
        )
      } catch {
        throw new DevotionalInputError("devotional input manifest is not JSON")
      }
      const parsedManifest = workspaceManifestSchema.safeParse(manifestPayload)
      if (
        !parsedManifest.success ||
        parsedManifest.data.kind !== "run-input" ||
        devotionalAttemptToken(parsedManifest.data.attempt.attemptId) !==
          inputManifestRef.key.split("/")[2]
      ) {
        throw new DevotionalInputError("devotional input manifest is invalid")
      }
      workspaceManifest = parsedManifest.data
      const specRef = workspaceManifest.artifacts.find(
        (entry) =>
          entry.artifactType === DEVOTIONAL_INPUT_ARTIFACT_TYPE &&
          entry.ext === "json",
      )?.ref
      if (!specRef) {
        throw new DevotionalInputError(
          "devotional input manifest omits the spec",
        )
      }
      raw = await storage.readWorkspaceArtifact(specRef)
    } else {
      raw = await storage.readArtifact(
        inputAssetId,
        DEVOTIONAL_INPUT_ARTIFACT_TYPE,
        "json",
      )
    }
    if (raw.byteLength > 1_000_000) {
      throw new DevotionalInputError("devotional render input exceeds 1MB")
    }
    let payload: unknown
    try {
      payload = JSON.parse(Buffer.from(raw).toString("utf8"))
    } catch {
      throw new DevotionalInputError("devotional render input is not JSON")
    }
    const parsed = devotionalRenderInputSchema.safeParse(payload)
    if (!parsed.success) {
      throw new DevotionalInputError(
        "devotional render input failed validation",
      )
    }
    const input = parsed.data

    if (workspaceManifest && !workspaceTransfer) {
      const attempt = workspaceManifest.attempt as DevotionalAttemptIdentity
      const existing = await storage.readWorkspaceManifest(
        attempt,
        "attempt-output",
      )
      if (existing) {
        let payload: unknown
        try {
          payload = JSON.parse(Buffer.from(existing.body).toString("utf8"))
        } catch {
          throw new DevotionalOutputError(
            "existing output manifest is not JSON",
          )
        }
        const completed = workspaceManifestSchema.safeParse(payload)
        const portraitRef = completed.success
          ? completed.data.artifacts.find(
              (entry) =>
                entry.artifactType === DEVOTIONAL_PORTRAIT_ARTIFACT_TYPE &&
                entry.ext === "mp4",
            )?.ref
          : undefined
        const wideRef = completed.success
          ? completed.data.artifacts.find(
              (entry) =>
                entry.artifactType === DEVOTIONAL_WIDE_ARTIFACT_TYPE &&
                entry.ext === "mp4",
            )?.ref
          : undefined
        if (
          !completed.success ||
          completed.data.kind !== "attempt-output" ||
          !completed.data.report ||
          !portraitRef ||
          !wideRef
        ) {
          throw new DevotionalOutputError(
            "existing output manifest is incomplete",
          )
        }
        await storage.verifyWorkspaceArtifact(portraitRef)
        await storage.verifyWorkspaceArtifact(wideRef)
        const finalAssetId = devotionalWorkspaceAssetId({
          kind: "output",
          workspaceGeneration: attempt.workspaceGeneration,
          attemptToken: devotionalAttemptToken(attempt.attemptId),
          manifestDigest: existing.ref.digest,
          manifestSize: existing.ref.size,
        })
        const portrait: DevotionalRenderOutput = {
          artifact: {
            assetId: finalAssetId,
            artifactType: DEVOTIONAL_PORTRAIT_ARTIFACT_TYPE,
            ext: "mp4",
            ...portraitRef,
          },
          ...completed.data.report.portrait,
        }
        const wide: DevotionalRenderOutput = {
          artifact: {
            assetId: finalAssetId,
            artifactType: DEVOTIONAL_WIDE_ARTIFACT_TYPE,
            ext: "mp4",
            ...wideRef,
          },
          ...completed.data.report.wide,
        }
        return {
          artifacts: [portrait.artifact, wide.artifact],
          report: { portrait, wide },
        }
      }
    }

    const cards: Array<Record<string, unknown>> = []
    for (const card of input.cards) {
      const { narrationId, ...content } = card
      if (card.kind === "video") {
        cards.push({ ...content, videoFile: "clip.mp4" })
        continue
      }
      if (!narrationId) {
        cards.push(content)
        continue
      }
      const artifactType = devotionalNarrationArtifactType(narrationId)
      const fileName = `${artifactType}.mp3`
      const filePath = join(publicDir, fileName)
      const narrationRef = workspaceManifest?.artifacts.find(
        (entry) => entry.artifactType === artifactType && entry.ext === "mp3",
      )?.ref
      if (workspaceTransfer) {
        const narrationGrant = workspaceTransfer.inputs.find(
          (entry) => entry.artifactType === artifactType && entry.ext === "mp3",
        )
        if (!narrationGrant) {
          throw new DevotionalInputError(
            `signed transfer omits ${artifactType}`,
          )
        }
        await downloadDevotionalWorkspaceGrant({
          grant: narrationGrant,
          filePath,
          maxBytes: NARRATION_DOWNLOAD_MAX_BYTES,
          fetchImpl,
          signal,
          nodeEnv,
        })
      } else if (workspaceManifest) {
        if (!narrationRef) {
          throw new DevotionalInputError(`input manifest omits ${artifactType}`)
        }
        await storage.readWorkspaceArtifactToFile(narrationRef, filePath)
      } else {
        await storage.readArtifactToFile(
          inputAssetId,
          artifactType,
          "mp3",
          filePath,
        )
      }
      cards.push({
        ...content,
        audioFile: fileName,
        durationSec: await probeDuration(
          filePath,
          runCommand,
          deadline,
          signal,
        ),
      })
    }
    if (input.music) {
      const musicPath = join(publicDir, `${DEVOTIONAL_MUSIC_ARTIFACT_TYPE}.mp3`)
      const musicRef = workspaceManifest?.artifacts.find(
        (entry) =>
          entry.artifactType === DEVOTIONAL_MUSIC_ARTIFACT_TYPE &&
          entry.ext === "mp3",
      )?.ref
      if (workspaceTransfer) {
        const musicGrant = workspaceTransfer.inputs.find(
          (entry) =>
            entry.artifactType === DEVOTIONAL_MUSIC_ARTIFACT_TYPE &&
            entry.ext === "mp3",
        )
        if (!musicGrant)
          throw new DevotionalInputError("signed transfer omits music")
        await downloadDevotionalWorkspaceGrant({
          grant: musicGrant,
          filePath: musicPath,
          maxBytes: MUSIC_DOWNLOAD_MAX_BYTES,
          fetchImpl,
          signal,
          nodeEnv,
        })
      } else if (workspaceManifest) {
        if (!musicRef)
          throw new DevotionalInputError("input manifest omits music")
        await storage.readWorkspaceArtifactToFile(musicRef, musicPath)
      } else {
        await storage.readArtifactToFile(
          inputAssetId,
          DEVOTIONAL_MUSIC_ARTIFACT_TYPE,
          "mp3",
          musicPath,
        )
      }
    }

    onProgress?.(0.05, "Resolving devotional source")
    const fullPath = join(tempDir, "source.mp4")
    if (input.media.sourceMediaRef) {
      if (workspaceTransfer) {
        const sourceGrant = workspaceTransfer.inputs.find(
          (entry) => entry.ref.key === input.media.sourceMediaRef?.key,
        )
        if (!sourceGrant) {
          throw new DevotionalInputError("signed transfer omits source media")
        }
        await downloadDevotionalWorkspaceGrant({
          grant: sourceGrant,
          filePath: fullPath,
          maxBytes: SOURCE_DOWNLOAD_MAX_BYTES,
          fetchImpl,
          signal,
          nodeEnv,
        })
      } else {
        await storage.readWorkspaceArtifactToFile(
          input.media.sourceMediaRef,
          fullPath,
        )
      }
    } else {
      const sourceUrl =
        input.media.sourceUrl ??
        (await resolveArclightSourceUrl(
          input.media.mediaId,
          fetchImpl,
          deadline,
          signal,
        ))
      await downloadSource(sourceUrl, fullPath, {
        fetchImpl,
        allowedHosts,
        nodeEnv,
        deadline,
        signal,
      })
    }
    const sourceProbe = await probeMedia(fullPath, {
      runCommand,
      timeoutMs: timeoutMs(deadline, DEFAULT_PROBE_TIMEOUT_MS),
      signal,
    })
    const usableSourceDuration = Math.max(
      1,
      sourceProbe.durationSec - SOURCE_TRAILER_SEC,
    )
    if (input.media.clipStartSec >= usableSourceDuration) {
      throw new DevotionalInputError(
        "clipStartSec is beyond the source duration",
      )
    }
    const available = usableSourceDuration - input.media.clipStartSec
    const sourceClipLength = Math.min(input.media.clipLengthSec + 3, available)
    const clipPath = join(publicDir, "clip.mp4")
    onProgress?.(0.09, "Preparing devotional clip")
    await trimVideo(fullPath, clipPath, {
      startSec: input.media.clipStartSec,
      lengthSec: sourceClipLength,
      speed: VIDEO_SPEED,
      normalize: sourceProbe.hasAudio,
      withoutAudio: !sourceProbe.hasAudio,
      runCommand,
      deadline,
      signal,
    })
    const clipProbe = await probeMedia(clipPath, {
      runCommand,
      timeoutMs: timeoutMs(deadline, DEFAULT_PROBE_TIMEOUT_MS),
      signal,
    })
    const videoCard = cards.find((card) => card.kind === "video")
    if (videoCard) {
      videoCard.durationSec = Math.min(
        clipProbe.durationSec,
        input.media.videoCardSec ?? input.media.clipLengthSec / VIDEO_SPEED,
      )
    }

    const timelineSec = backgroundTimelineSec(cards)
    const backgroundLength = Math.min(timelineSec, usableSourceDuration)
    onProgress?.(0.12, "Preparing devotional background")
    await trimVideo(fullPath, join(publicDir, "bg.mp4"), {
      startSec: 0,
      lengthSec: backgroundLength,
      withoutAudio: true,
      runCommand,
      deadline,
      signal,
    })

    const inputProps: Record<string, unknown> = {
      renderConfig: input.renderConfig,
      headerDate: input.headerDate,
      ...(input.attribution ? { attribution: input.attribution } : {}),
      cards,
      audioDurationSec: cards.reduce(
        (sum, card) =>
          sum + (typeof card.durationSec === "number" ? card.durationSec : 0),
        0,
      ),
      bgFile: "bg.mp4",
      bgDurationSec: backgroundLength,
      bgPlaybackRate:
        timelineSec > backgroundLength
          ? Math.max(0.8, backgroundLength / timelineSec)
          : 1,
      ...(input.music
        ? { musicFile: `${DEVOTIONAL_MUSIC_ARTIFACT_TYPE}.mp3` }
        : {}),
      style: input.render.style,
      layout: input.render.layout,
      textAnim: "letters",
      showMuteButton: false,
      musicVolume: input.render.musicVolume,
      xfadeSec: input.render.xfadeSec,
      videoAudioLevel: input.render.videoAudioLevel,
    }

    onProgress?.(0.16, "Bundling devotional composition")
    const serveUrl = await withDeadline(
      prepareServeUrl(engine, bundleDir, publicDir, serveDir),
      deadline,
      signal,
    )
    const openingBrowser = engine.openBrowser()
    try {
      browser = await withDeadline(openingBrowser, deadline, signal)
    } catch (error) {
      // Promise.race cannot cancel Chromium startup. If the deadline/cancel
      // wins, close a browser that resolves later instead of orphaning it.
      void openingBrowser
        .then((lateBrowser) => lateBrowser.close({ silent: true }))
        .catch(() => {})
      throw error
    }
    const portraitPath = join(tempDir, "portrait.mp4")
    const widePath = join(tempDir, "wide.mp4")
    const portrait = await renderAspect({
      aspect: "portrait",
      outputAssetId,
      engine,
      browser,
      serveUrl,
      inputProps,
      outputPath: portraitPath,
      concurrency,
      deadline,
      onProgress,
      signal,
    })
    const wide = await renderAspect({
      aspect: "wide",
      outputAssetId,
      engine,
      browser,
      serveUrl,
      inputProps,
      outputPath: widePath,
      concurrency,
      deadline,
      onProgress,
      signal,
    })

    for (const [aspect, outputPath, output] of [
      ["portrait", portraitPath, portrait],
      ["wide", widePath, wide],
    ] as const) {
      const probe = await probeMedia(outputPath, {
        runCommand,
        timeoutMs: timeoutMs(deadline, DEFAULT_PROBE_TIMEOUT_MS),
        signal,
      })
      if (
        probe.width !== output.width ||
        probe.height !== output.height ||
        Math.abs(probe.durationSec - output.outputDurationSec) >
          OUTPUT_DURATION_TOLERANCE_SEC
      ) {
        throw new DevotionalOutputError(
          `${aspect} output failed dimension or duration validation`,
        )
      }
      output.outputDurationSec = probe.durationSec
    }

    onProgress?.(0.9, "Uploading devotional outputs")
    if (workspaceTransfer) {
      const portraitGrant = workspaceTransfer.outputs.find(
        ({ artifactType }) =>
          artifactType === DEVOTIONAL_PORTRAIT_ARTIFACT_TYPE,
      )
      const wideGrant = workspaceTransfer.outputs.find(
        ({ artifactType }) => artifactType === DEVOTIONAL_WIDE_ARTIFACT_TYPE,
      )
      if (!portraitGrant || !wideGrant) {
        throw new DevotionalOutputError(
          "signed transfer omits devotional output grants",
        )
      }
      const [portraitRef, wideRef] = await Promise.all([
        uploadDevotionalWorkspaceGrant({
          grant: portraitGrant,
          attempt: workspaceTransfer.attempt,
          assetId: outputAssetId,
          filePath: portraitPath,
          fetchImpl,
          signal,
          nodeEnv,
        }),
        uploadDevotionalWorkspaceGrant({
          grant: wideGrant,
          attempt: workspaceTransfer.attempt,
          assetId: outputAssetId,
          filePath: widePath,
          fetchImpl,
          signal,
          nodeEnv,
        }),
      ])
      portrait.artifact = portraitRef
      wide.artifact = wideRef
      written.push(portraitRef, wideRef)
    } else if (workspaceManifest) {
      const attempt = workspaceManifest.attempt as DevotionalAttemptIdentity
      const outputEntries: Array<{
        artifactType: string
        ext: string
        ref: WorkspaceArtifactRef
      }> = []
      for (const [output, filePath, fileName] of [
        [portrait, portraitPath, "portrait.mp4"],
        [wide, widePath, "wide.mp4"],
      ] as const) {
        const { digest, size } = await fileDigest(filePath)
        const ref = await storage.writeWorkspaceArtifactFromFile({
          key: devotionalWorkspaceKey(
            attempt,
            "attempt-output",
            digest,
            fileName,
          ),
          filePath,
          digest,
          size,
          contentType: "video/mp4",
          attempt,
        })
        outputEntries.push({
          artifactType: output.artifact.artifactType,
          ext: "mp4",
          ref,
        })
      }
      const manifestBody = Buffer.from(
        JSON.stringify({
          schemaVersion: "2",
          kind: "attempt-output",
          attempt,
          artifacts: outputEntries,
          report: {
            portrait: {
              outputDurationSec: portrait.outputDurationSec,
              width: portrait.width,
              height: portrait.height,
            },
            wide: {
              outputDurationSec: wide.outputDurationSec,
              width: wide.width,
              height: wide.height,
            },
          },
        }),
      )
      const manifestDigest = createHash("sha256")
        .update(manifestBody)
        .digest("hex")
      const manifestRef = await storage.writeWorkspaceArtifact({
        key: devotionalManifestKey(attempt, "attempt-output"),
        body: manifestBody,
        digest: manifestDigest,
        size: manifestBody.byteLength,
        contentType: "application/json",
        attempt,
      })
      const finalAssetId = devotionalWorkspaceAssetId({
        kind: "output",
        workspaceGeneration: attempt.workspaceGeneration,
        attemptToken: devotionalAttemptToken(attempt.attemptId),
        manifestDigest: manifestRef.digest,
        manifestSize: manifestRef.size,
      })
      for (const [output, entry] of [
        [portrait, outputEntries[0]!],
        [wide, outputEntries[1]!],
      ] as const) {
        output.artifact = {
          assetId: finalAssetId,
          artifactType: output.artifact.artifactType,
          ext: "mp4",
          ...entry.ref,
        }
        written.push(output.artifact)
      }
    } else {
      for (const [output, filePath] of [
        [portrait, portraitPath],
        [wide, widePath],
      ] as const) {
        await storage.writeArtifactFromFile(
          outputAssetId,
          output.artifact.artifactType,
          "mp4",
          filePath,
          "video/mp4",
        )
        written.push(output.artifact)
      }
    }
    const report: DevotionalRenderReport = { portrait, wide }
    const meta: DevotionalRenderMetaArtifact = {
      schemaVersion: "1",
      runId,
      inputAssetId,
      inputHash,
      portrait,
      wide,
      generatedAt: now().toISOString(),
    }
    const metaRef: ArtifactRef = {
      assetId: outputAssetId,
      artifactType: DEVOTIONAL_RENDER_META_ARTIFACT_TYPE,
      ext: "json",
    }
    if (!workspaceManifest) {
      written.push(metaRef)
      await storage.writeArtifact({
        ...metaRef,
        body: JSON.stringify(meta, null, 2),
        contentType: "application/json",
      })
    }
    return { artifacts: [...written], report }
  } catch (error) {
    // Workspace artifacts are immutable and content-addressed. A crash before
    // the manifest is written leaves them unreachable, but they must not be
    // deleted: another replay may already be relying on the same valid bytes.
    if (!workspaceManifest) {
      await Promise.all(
        written.map((artifact) =>
          storage
            .deleteArtifact(
              artifact.assetId,
              artifact.artifactType,
              artifact.ext,
            )
            .catch(() => {}),
        ),
      )
    }
    throw error
  } finally {
    if (browser) await browser.close({ silent: true }).catch(() => {})
    await rm(tempDir, { recursive: true, force: true }).catch(() => {})
  }
}

export function devotionalOutputKey(ref: ArtifactRef): string {
  return artifactKey(ref.assetId, ref.artifactType, ref.ext)
}
