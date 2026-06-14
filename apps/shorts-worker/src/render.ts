// Render pipeline (plan decision 7 + render knobs): download the clip
// artifact → loopback single-file server → selectComposition + renderMedia
// against the baked bundle (SHORTS_WORKER_BUNDLE_DIR; runtime-memoized
// bundle() for local dev) → ffprobe output sanity → artifacts.
//
// ALL remotion imports (@remotion/renderer, @remotion/bundler) stay inside
// lazy dynamic imports in createDefaultRenderEngine so unit tests of other
// modules never load Chromium-adjacent code. The engine is injectable (DI)
// for tests; the real engine is the default in production wiring.

import { createRequire } from "node:module"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import {
  SHORT_HEIGHT,
  SHORT_WIDTH,
  SHORT_COMPOSITION_ID,
  type ShortInputProps,
} from "@forge/shorts-compositions/schema"
import { COMPOSITIONS_VERSION } from "@forge/shorts-compositions/version"
import { startClipServer, type ClipServer } from "./clip-server.js"
import { env } from "./config/env.js"
import { JobDeadlineExceededError, type JobDeadline } from "./deadline.js"
import { WorkerError } from "./errors.js"
import {
  DEFAULT_PROBE_TIMEOUT_MS,
  defaultRunCommand,
  probeMedia,
  type RunCommand,
} from "./ffmpeg.js"
import { CLIP_ARTIFACT_TYPE } from "./prepare.js"
import { createStorage, type Storage } from "./storage.js"
import type { ArtifactRef, RenderMetaArtifact, RenderReport } from "./types.js"

export const OUTPUT_ARTIFACT_TYPE = "shorts-output-v1"
export const RENDER_META_ARTIFACT_TYPE = "shorts-render-meta-v1"

// Per-delayRender timeout, NOT the job ceiling (that's the enqueue-time
// deadline). 120s covers slow font/audio-data resolution.
const DELAY_RENDER_TIMEOUT_MS = 120_000
// Cap the OffthreadVideo frame cache: the default scales with free RAM and
// risks the OOM-killer at 8GB (plan render knobs).
const OFFTHREAD_VIDEO_CACHE_BYTES = 1024 * 1024 * 1024
// Output duration must match the requested clip within this tolerance.
const OUTPUT_DURATION_TOLERANCE_SEC = 0.5

export class OutputSanityError extends WorkerError {
  constructor(message: string) {
    super(message, "output_sanity_failed", false)
    this.name = "OutputSanityError"
  }
}

// Props arrive WITHOUT clipUrl — the worker injects the loopback URL at
// compose time (plan decision 7/15). propsHash is opaque: never recomputed.
export type RenderProps = Omit<ShortInputProps, "clipUrl">

export type EngineBrowser = {
  close(options: { silent: boolean }): Promise<unknown>
}

export type EngineComposition = {
  id: string
  width: number
  height: number
  fps: number
  durationInFrames: number
}

export type RenderEngine = {
  bundle(options: { entryPoint: string }): Promise<string>
  openBrowser(): Promise<EngineBrowser>
  selectComposition(options: {
    serveUrl: string
    id: string
    inputProps: Record<string, unknown>
    puppeteerInstance: EngineBrowser
    timeoutInMilliseconds: number
  }): Promise<EngineComposition>
  renderMedia(options: {
    composition: EngineComposition
    serveUrl: string
    codec: "h264"
    outputLocation: string
    inputProps: Record<string, unknown>
    puppeteerInstance: EngineBrowser
    concurrency: number
    offthreadVideoCacheSizeInBytes: number
    timeoutInMilliseconds: number
    onProgress: (progress: { progress: number }) => void
  }): Promise<unknown>
}

export function createDefaultRenderEngine(): RenderEngine {
  return {
    async bundle({ entryPoint }) {
      const { bundle } = await import("@remotion/bundler")
      return bundle({ entryPoint, webpackOverride: (config) => config })
    },
    async openBrowser() {
      const { openBrowser } = await import("@remotion/renderer")
      const browser = await openBrowser("chrome")
      return browser as unknown as EngineBrowser
    },
    async selectComposition(options) {
      const { selectComposition } = await import("@remotion/renderer")
      const composition = await selectComposition({
        serveUrl: options.serveUrl,
        id: options.id,
        inputProps: options.inputProps,
        puppeteerInstance: options.puppeteerInstance as unknown as Parameters<
          typeof selectComposition
        >[0]["puppeteerInstance"],
        timeoutInMilliseconds: options.timeoutInMilliseconds,
      })
      return composition as unknown as EngineComposition
    },
    async renderMedia(options) {
      const { renderMedia } = await import("@remotion/renderer")
      return renderMedia({
        composition: options.composition as unknown as Parameters<
          typeof renderMedia
        >[0]["composition"],
        serveUrl: options.serveUrl,
        codec: options.codec,
        outputLocation: options.outputLocation,
        inputProps: options.inputProps,
        puppeteerInstance: options.puppeteerInstance as unknown as Parameters<
          typeof renderMedia
        >[0]["puppeteerInstance"],
        concurrency: options.concurrency,
        offthreadVideoCacheSizeInBytes: options.offthreadVideoCacheSizeInBytes,
        timeoutInMilliseconds: options.timeoutInMilliseconds,
        onProgress: options.onProgress,
      })
    },
  }
}

function resolveCompositionsEntryPoint(): string {
  // import.meta.resolve honors the package's exports map; createRequire is
  // the fallback for runtimes that don't implement it.
  try {
    return fileURLToPath(
      import.meta.resolve("@forge/shorts-compositions/entry"),
    )
  } catch {
    return createRequire(import.meta.url).resolve(
      "@forge/shorts-compositions/entry",
    )
  }
}

// Runtime bundle memoization (local dev only — production uses the baked
// SHORTS_WORKER_BUNDLE_DIR). A failed bundle clears the cache so the next
// job retries instead of replaying the rejection forever.
let runtimeBundlePromise: Promise<string> | null = null

function resolveServeUrl(
  engine: RenderEngine,
  bundleDir: string | undefined,
): Promise<string> {
  if (bundleDir) return Promise.resolve(bundleDir)
  if (!runtimeBundlePromise) {
    runtimeBundlePromise = engine
      .bundle({ entryPoint: resolveCompositionsEntryPoint() })
      .catch((error: unknown) => {
        runtimeBundlePromise = null
        throw error
      })
  }
  return runtimeBundlePromise
}

export function _resetRuntimeBundleCacheForTests(): void {
  runtimeBundlePromise = null
}

// renderMedia/selectComposition are not RunCommand subprocesses, so the
// job deadline is enforced by racing them against the remaining budget; the
// per-job browser teardown in finally reclaims Chromium on timeout.
async function withDeadline<T>(
  promise: Promise<T>,
  deadline: JobDeadline | undefined,
): Promise<T> {
  if (!deadline) return promise
  const remainingMs = deadline.capTimeoutMs(Number.MAX_SAFE_INTEGER)
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new JobDeadlineExceededError(deadline.elapsedMs())),
      remainingMs,
    )
  })
  try {
    return await Promise.race([promise, timeout])
  } finally {
    clearTimeout(timer)
  }
}

export type RenderProgress = (progress: number, message: string) => void

export type RenderDependencies = {
  storage?: Storage
  engine?: RenderEngine
  runCommand?: RunCommand
  /** Per-JOB deadline (set at enqueue time). */
  deadline?: JobDeadline
  bundleDir?: string | undefined
  concurrency?: number
  now?: () => Date
}

export type RunRenderInput = {
  assetId: string
  /** Opaque dedupe token computed by manager — NEVER recomputed here. */
  propsHash: string
  draftVersion: number
  props: RenderProps
  deps?: RenderDependencies
  onProgress?: RenderProgress
}

export type RunRenderResult = {
  artifacts: ArtifactRef[]
  report: RenderReport
}

export async function runRender({
  assetId,
  propsHash,
  draftVersion,
  props,
  deps = {},
  onProgress,
}: RunRenderInput): Promise<RunRenderResult> {
  const storage = deps.storage ?? createStorage()
  const engine = deps.engine ?? createDefaultRenderEngine()
  const runCommand = deps.runCommand ?? defaultRunCommand
  const deadline = deps.deadline
  const bundleDir =
    deps.bundleDir !== undefined ? deps.bundleDir : env.SHORTS_WORKER_BUNDLE_DIR
  const concurrency = deps.concurrency ?? env.SHORTS_WORKER_RENDER_CONCURRENCY
  const now = deps.now ?? (() => new Date())

  const tempDir = await mkdtemp(join(tmpdir(), "shorts-worker-render-"))
  let clipServer: ClipServer | null = null
  try {
    onProgress?.(0.02, "Fetching clip artifact")
    const clipPath = join(tempDir, "clip.mp4")
    await storage.readArtifactToFile(
      assetId,
      CLIP_ARTIFACT_TYPE,
      "mp4",
      clipPath,
    )

    clipServer = await startClipServer(clipPath)
    onProgress?.(0.05, "Resolving composition bundle")
    const serveUrl = await withDeadline(
      resolveServeUrl(engine, bundleDir),
      deadline,
    )

    const inputProps: Record<string, unknown> = {
      ...props,
      clipUrl: clipServer.url,
    }

    onProgress?.(0.1, "Opening renderer")
    const browser = await withDeadline(engine.openBrowser(), deadline)
    const outputPath = join(tempDir, "output.mp4")
    try {
      const composition = await withDeadline(
        engine.selectComposition({
          serveUrl,
          id: SHORT_COMPOSITION_ID,
          inputProps,
          puppeteerInstance: browser,
          timeoutInMilliseconds: DELAY_RENDER_TIMEOUT_MS,
        }),
        deadline,
      )

      // Throttle render progress to ~5% steps so the job record isn't
      // hammered once per frame.
      let lastReported = -1
      await withDeadline(
        engine.renderMedia({
          composition,
          serveUrl,
          codec: "h264",
          outputLocation: outputPath,
          inputProps,
          puppeteerInstance: browser,
          concurrency,
          offthreadVideoCacheSizeInBytes: OFFTHREAD_VIDEO_CACHE_BYTES,
          timeoutInMilliseconds: DELAY_RENDER_TIMEOUT_MS,
          onProgress: ({ progress }) => {
            if (progress - lastReported >= 0.05 || progress >= 1) {
              lastReported = progress
              onProgress?.(
                0.15 + progress * 0.75,
                `Rendering ${Math.round(progress * 100)}%`,
              )
            }
          },
        }),
        deadline,
      )
    } finally {
      // Per-job browser: opened above, closed here — no cross-job reuse
      // (memory-creep insurance; plan render knobs).
      try {
        await browser.close({ silent: true })
      } catch {
        // Never let browser teardown mask the render outcome.
      }
    }

    onProgress?.(0.92, "Verifying output")
    const probe = await probeMedia(outputPath, {
      runCommand,
      timeoutMs: deadline
        ? deadline.capTimeoutMs(DEFAULT_PROBE_TIMEOUT_MS)
        : DEFAULT_PROBE_TIMEOUT_MS,
    })
    if (probe.width !== SHORT_WIDTH || probe.height !== SHORT_HEIGHT) {
      throw new OutputSanityError(
        `rendered output is ${probe.width}x${probe.height}, expected ${SHORT_WIDTH}x${SHORT_HEIGHT}`,
      )
    }
    if (
      Math.abs(probe.durationSec - props.clipDurationSec) >
      OUTPUT_DURATION_TOLERANCE_SEC
    ) {
      throw new OutputSanityError(
        `rendered output duration ${probe.durationSec}s is outside ±${OUTPUT_DURATION_TOLERANCE_SEC}s of the clip duration ${props.clipDurationSec}s`,
      )
    }

    onProgress?.(0.95, "Uploading output")
    await storage.writeArtifactFromFile(
      assetId,
      OUTPUT_ARTIFACT_TYPE,
      "mp4",
      outputPath,
      "video/mp4",
    )

    const renderMeta: RenderMetaArtifact = {
      propsHash,
      renderedDraftVersion: draftVersion,
      compositionsVersion: COMPOSITIONS_VERSION,
      generatedAt: now().toISOString(),
    }
    await storage.writeArtifact({
      assetId,
      artifactType: RENDER_META_ARTIFACT_TYPE,
      ext: "json",
      body: JSON.stringify(renderMeta, null, 2),
      contentType: "application/json",
    })

    const artifacts: ArtifactRef[] = [
      { assetId, artifactType: OUTPUT_ARTIFACT_TYPE, ext: "mp4" },
      { assetId, artifactType: RENDER_META_ARTIFACT_TYPE, ext: "json" },
    ]

    return {
      artifacts,
      report: {
        outputDurationSec: probe.durationSec,
        width: probe.width,
        height: probe.height,
      },
    }
  } finally {
    if (clipServer) {
      await clipServer.close().catch(() => {})
    }
    await rm(tempDir, { recursive: true, force: true })
  }
}
