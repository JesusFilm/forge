// Render pipeline: crop plan (+ optional timeline map) → per-segment FFmpeg
// crop/scale/encode → concat → upload → preview frames → render report.
// Artifact shapes and key names follow
// docs/plans/2026-06-09-002-feat-smart-crop-plan.md exactly.

import { mkdtemp, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { env } from "./config/env.js"
import {
  CROP_PLAN_ARTIFACT_TYPE,
  parseCropPlan,
  parseTimelineMap,
  remapSegments,
  samplePreviewSegments,
  type CropPlanArtifactType,
  type CropPlan,
  type RenderArtifactSuffix,
  type TimelineMap,
} from "./crop-plan.js"
import type { JobDeadline } from "./deadline.js"
import {
  classifyCommandError,
  defaultRunCommand,
  sourceProtocolWhitelist,
  type RunCommand,
} from "./ffmpeg.js"
import { createStorage, type Storage } from "./storage.js"
import type {
  ArtifactRef,
  CropKeyframe,
  RenderedReportSegment,
  RenderMode,
  RenderReport,
  RenderSegment,
} from "./types.js"

export { CROP_PLAN_ARTIFACT_TYPE } from "./crop-plan.js"
export const TIMELINE_MAP_ARTIFACT_TYPE = "smart-crop-timeline-map-v1"
export const PREVIEW_OUTPUT_ARTIFACT_TYPE = "smart-crop-preview-9x16"
export const FULL_OUTPUT_ARTIFACT_TYPE = "smart-crop-output-9x16"

const TARGET_WIDTH = 1080
const TARGET_HEIGHT = 1920

function roundToEven(value: number): number {
  return 2 * Math.round(value / 2)
}

export function buildXExpression(
  keyframes: CropKeyframe[],
  durationSeconds: number,
): string {
  const sorted = [...keyframes].sort((a, b) => a.progress - b.progress)
  const xs = sorted.map((keyframe) => roundToEven(keyframe.x))

  if (xs.length === 1) return String(xs[0])

  if (xs.length === 2) {
    const x0 = xs[0]!
    const x1 = xs[1]!
    if (x0 === x1) return String(x0)
    // The full-span lerp shortcut is only valid when the two keyframes sit
    // exactly at progress 0 and 1; any other pair falls through to the
    // piecewise path below, which honors the keyframes' progress values.
    if (sorted[0]!.progress === 0 && sorted[1]!.progress === 1) {
      // min(t/D,1) clamps the pan at the segment end. The caller wraps this
      // expression in single quotes so ffmpeg's filter parser does not split
      // the filtergraph on the comma inside min(...).
      return `${x0}+${x1 - x0}*min(t/${durationSeconds},1)`
    }
  }

  // Piecewise linear interpolation via nested if(lt(t,...)) expressions.
  const times = sorted.map((keyframe) => keyframe.progress * durationSeconds)
  let expression = String(xs[xs.length - 1])
  for (let index = xs.length - 2; index >= 0; index--) {
    const t0 = times[index]!
    const t1 = times[index + 1]!
    const span = t1 - t0
    if (span <= 0) continue
    const x0 = xs[index]!
    const dx = xs[index + 1]! - x0
    const piece =
      dx === 0 ? String(x0) : `${x0}+${dx}*min(max((t-${t0})/${span},0),1)`
    expression = `if(lt(t,${t1}),${piece},${expression})`
  }
  return expression
}

export function buildCropFilter(segment: RenderSegment): string {
  const sorted = [...segment.keyframes].sort((a, b) => a.progress - b.progress)
  const first = sorted[0]
  if (!first) {
    throw new Error(`segment ${segment.shotId} has no crop keyframes`)
  }

  const xExpression = buildXExpression(sorted, segment.durationSeconds)

  return `crop=${first.width}:${first.height}:'${xExpression}':${first.y},scale=${TARGET_WIDTH}:${TARGET_HEIGHT}:flags=lanczos,setsar=1,setpts=PTS-STARTPTS`
}

export type RenderProgress = (progress: number, message: string) => void

export type RenderDependencies = {
  runCommand?: RunCommand
  storage?: Storage
  timeoutMs?: number
  /** Per-JOB deadline (set at enqueue time); caps every invocation below the remaining budget. */
  deadline?: JobDeadline
  protocolWhitelist?: string
  previewMaxSegments?: number
  previewMaxSeconds?: number
  now?: () => Date
}

export type RunRenderInput = {
  assetId: string
  sourceUrl: string
  mode: RenderMode
  cropPlanAssetId: string
  cropPlanArtifactType?: CropPlanArtifactType
  timelineMapAssetId?: string
  artifactSuffix?: RenderArtifactSuffix
  previewFrameCount: number
  deps?: RenderDependencies
  onProgress?: RenderProgress
}

export type RunRenderResult = {
  artifacts: ArtifactRef[]
  report: RenderReport
}

async function readJsonArtifact(
  storage: Storage,
  assetId: string,
  artifactType: string,
  label: string,
): Promise<unknown> {
  let bytes: Uint8Array
  try {
    bytes = await storage.readArtifact(assetId, artifactType, "json")
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(
      `failed to read ${label} artifact ${assetId}/${artifactType}.json: ${message}`,
    )
  }

  try {
    return JSON.parse(Buffer.from(bytes).toString("utf8")) as unknown
  } catch {
    throw new Error(
      `${label} artifact ${assetId}/${artifactType}.json is not valid JSON`,
    )
  }
}

function suffixArtifactType(
  artifactType: string,
  suffix: RenderArtifactSuffix | undefined,
): string {
  return suffix ? `${artifactType}-${suffix}` : artifactType
}

function buildRenderedSegments(
  segments: RenderSegment[],
): RenderedReportSegment[] {
  let outputStartSeconds = 0
  return segments.map((segment) => {
    const outputEndSeconds = outputStartSeconds + segment.durationSeconds
    const renderedSegment: RenderedReportSegment = {
      shotId: segment.shotId,
      sourceStartSeconds: segment.start,
      sourceEndSeconds: segment.end,
      outputStartSeconds,
      outputEndSeconds,
      durationSeconds: segment.durationSeconds,
    }
    outputStartSeconds = outputEndSeconds
    return renderedSegment
  })
}

export async function runRender({
  assetId,
  sourceUrl,
  mode,
  cropPlanAssetId,
  cropPlanArtifactType = CROP_PLAN_ARTIFACT_TYPE,
  timelineMapAssetId,
  artifactSuffix,
  previewFrameCount,
  deps = {},
  onProgress,
}: RunRenderInput): Promise<RunRenderResult> {
  const runCommand = deps.runCommand ?? defaultRunCommand
  const storage = deps.storage ?? createStorage()
  const timeoutMs = deps.timeoutMs ?? env.CROP_WORKER_FFMPEG_RENDER_TIMEOUT_MS
  const deadline = deps.deadline
  const protocolWhitelist = deps.protocolWhitelist ?? sourceProtocolWhitelist()
  // Per-invocation timeout = min(per-invocation cap, remaining job budget);
  // throws JobDeadlineExceededError once the job deadline has passed.
  const invocationTimeoutMs = (): number =>
    deadline ? deadline.capTimeoutMs(timeoutMs) : timeoutMs
  const previewMaxSegments =
    deps.previewMaxSegments ?? env.CROP_WORKER_PREVIEW_MAX_SEGMENTS
  const previewMaxSeconds =
    deps.previewMaxSeconds ?? env.CROP_WORKER_PREVIEW_MAX_SECONDS
  const now = deps.now ?? (() => new Date())
  const startedAtMs = Date.now()

  const plan: CropPlan = parseCropPlan(
    await readJsonArtifact(
      storage,
      cropPlanAssetId,
      cropPlanArtifactType,
      "crop plan",
    ),
  )

  const timelineMap: TimelineMap | null = timelineMapAssetId
    ? parseTimelineMap(
        await readJsonArtifact(
          storage,
          timelineMapAssetId,
          TIMELINE_MAP_ARTIFACT_TYPE,
          "timeline map",
        ),
      )
    : null

  const remapped = remapSegments(plan, timelineMap)
  const warnings = [...remapped.warnings]

  const segments: RenderSegment[] =
    mode === "preview"
      ? samplePreviewSegments(remapped.segments, {
          maxSegments: previewMaxSegments,
          maxSeconds: previewMaxSeconds,
        })
      : remapped.segments

  if (segments.length === 0) {
    throw new Error(
      `no renderable segments for ${assetId} (plan ${cropPlanAssetId}${timelineMapAssetId ? `, timeline map ${timelineMapAssetId}` : ""})`,
    )
  }

  const outputArtifactType =
    mode === "preview"
      ? suffixArtifactType(PREVIEW_OUTPUT_ARTIFACT_TYPE, artifactSuffix)
      : suffixArtifactType(FULL_OUTPUT_ARTIFACT_TYPE, artifactSuffix)

  const tempDir = await mkdtemp(join(tmpdir(), "crop-worker-render-"))
  try {
    // Per-segment crop/scale/encode.
    const segmentFileNames: string[] = []
    let segmentsRendered = 0
    for (const [index, segment] of segments.entries()) {
      const segmentFileName = `seg_${String(index).padStart(3, "0")}.mp4`
      const segmentPath = join(tempDir, segmentFileName)
      const filter = buildCropFilter(segment)

      try {
        await runCommand(
          "ffmpeg",
          [
            "-y",
            "-protocol_whitelist",
            protocolWhitelist,
            "-ss",
            String(segment.start),
            "-t",
            String(segment.durationSeconds),
            "-i",
            sourceUrl,
            "-vf",
            filter,
            "-af",
            "asetpts=PTS-STARTPTS",
            "-c:v",
            "libx264",
            "-preset",
            "veryfast",
            "-crf",
            "21",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            "-b:a",
            "128k",
            "-movflags",
            "+faststart",
            segmentPath,
          ],
          { timeoutMs: invocationTimeoutMs() },
        )
      } catch (error) {
        throw classifyCommandError(error, "ffmpeg")
      }

      segmentFileNames.push(segmentFileName)
      segmentsRendered += 1
      onProgress?.(
        (segmentsRendered / segments.length) * 0.9,
        `Rendering segment ${segmentsRendered} of ${segments.length}`,
      )
    }

    // Concat with stream copy.
    const listPath = join(tempDir, "list.txt")
    await writeFile(
      listPath,
      segmentFileNames.map((name) => `file '${name}'`).join("\n") + "\n",
    )
    const outputPath = join(tempDir, "output.mp4")
    try {
      // The concat input is a worker-generated local list file, NOT the
      // request-supplied source URL — it keeps ffmpeg's default protocol set
      // (it legitimately needs file access). Do not add the restrictive
      // source whitelist here.
      await runCommand(
        "ffmpeg",
        [
          "-y",
          "-f",
          "concat",
          "-safe",
          "0",
          "-i",
          listPath,
          "-c",
          "copy",
          outputPath,
        ],
        { timeoutMs: invocationTimeoutMs() },
      )
    } catch (error) {
      throw classifyCommandError(error, "ffmpeg")
    }

    const { size: outputBytes } = await stat(outputPath)
    const outputDurationSeconds = segments.reduce(
      (sum, segment) => sum + segment.durationSeconds,
      0,
    )

    const artifacts: ArtifactRef[] = []

    await storage.writeArtifactFromFile(
      assetId,
      outputArtifactType,
      "mp4",
      outputPath,
      "video/mp4",
    )
    artifacts.push({ assetId, artifactType: outputArtifactType, ext: "mp4" })

    // Preview frames for AI QA.
    const previewFrameArtifactTypes: string[] = []
    if (previewFrameCount > 0) {
      for (let index = 0; index < previewFrameCount; index++) {
        const frameTime =
          (outputDurationSeconds * (index + 0.5)) / previewFrameCount
        const frameFileName = `frame_${String(index + 1).padStart(3, "0")}.jpg`
        const framePath = join(tempDir, frameFileName)
        try {
          await runCommand(
            "ffmpeg",
            [
              "-y",
              "-ss",
              String(frameTime),
              "-i",
              outputPath,
              "-frames:v",
              "1",
              "-q:v",
              "3",
              framePath,
            ],
            { timeoutMs: invocationTimeoutMs() },
          )
        } catch (error) {
          throw classifyCommandError(error, "ffmpeg")
        }

        const frameArtifactType = suffixArtifactType(
          `smart-crop-preview-frame-9x16-${String(index + 1).padStart(3, "0")}`,
          artifactSuffix,
        )
        await storage.writeArtifactFromFile(
          assetId,
          frameArtifactType,
          "jpg",
          framePath,
          "image/jpeg",
        )
        previewFrameArtifactTypes.push(frameArtifactType)
        artifacts.push({ assetId, artifactType: frameArtifactType, ext: "jpg" })
      }
    }

    const report: RenderReport = {
      version: 1,
      kind: "smart-crop-render-report",
      assetId,
      mode,
      cropPlanArtifactType,
      ...(artifactSuffix ? { artifactSuffix } : {}),
      target: {
        aspectRatio: "9:16",
        width: TARGET_WIDTH,
        height: TARGET_HEIGHT,
      },
      segmentsRendered,
      segmentsPlanned: segments.length,
      renderedSegments: buildRenderedSegments(segments),
      outputDurationSeconds,
      outputBytes,
      renderSeconds: (Date.now() - startedAtMs) / 1000,
      previewFrameArtifactTypes,
      warnings,
      tool: "crop-worker-render-v1",
      generatedAt: now().toISOString(),
    }

    const reportArtifactType = suffixArtifactType(
      `smart-crop-render-report-9x16-${mode}`,
      artifactSuffix,
    )
    await storage.writeArtifact({
      assetId,
      artifactType: reportArtifactType,
      ext: "json",
      body: JSON.stringify(report, null, 2),
      contentType: "application/json",
    })
    artifacts.push({ assetId, artifactType: reportArtifactType, ext: "json" })

    return { artifacts, report }
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
}
