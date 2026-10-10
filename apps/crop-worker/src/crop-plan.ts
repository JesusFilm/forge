// Local Zod schemas for the canonical crop plan + timeline map artifacts
// (shapes defined in docs/plans/2026-06-09-002-feat-smart-crop-plan.md) and
// the deterministic plan-segment → render-segment remapping.
//
// Schemas are loose (tolerate extra fields) so producer-side additive changes
// don't break the worker, but the documented fields are validated exactly.

import { z } from "zod"
import type { RenderSegment } from "./types.js"

export const CROP_PLAN_ARTIFACT_TYPE = "smart-crop-plan-9x16-v1"
export const CROP_PLAN_ATTEMPT_ARTIFACT_TYPE_PATTERN =
  /^smart-crop-plan-9x16-attempt-\d{3}-v1$/
export const RENDER_ARTIFACT_SUFFIX_PATTERN = /^attempt-\d{3}$/

export const cropPlanArtifactTypeSchema = z.union([
  z.literal(CROP_PLAN_ARTIFACT_TYPE),
  z.string().regex(CROP_PLAN_ATTEMPT_ARTIFACT_TYPE_PATTERN),
])

export const renderArtifactSuffixSchema = z
  .string()
  .regex(RENDER_ARTIFACT_SUFFIX_PATTERN)

export type CropPlanArtifactType = z.infer<typeof cropPlanArtifactTypeSchema>
export type RenderArtifactSuffix = z.infer<typeof renderArtifactSuffixSchema>

const cropKeyframeSchema = z.looseObject({
  progress: z.number().min(0).max(1),
  x: z.number(),
  y: z.number(),
  width: z.number().positive(),
  height: z.number().positive(),
})

const planSegmentSchema = z.looseObject({
  shotId: z.string().min(1),
  canonicalStart: z.number().min(0),
  canonicalEnd: z.number().min(0),
  mode: z.enum([
    "speaker",
    "group",
    "object",
    "slide_aware",
    "action",
    "center_fallback",
  ]),
  primarySubject: z.string().optional(),
  secondarySubjects: z.array(z.string()).optional(),
  avoidCutting: z.array(z.string()).optional(),
  confidence: z.number().min(0).max(1),
  cropKeyframes: z.array(cropKeyframeSchema).min(1),
})

export const cropPlanSchema = z.looseObject({
  version: z.literal(1),
  kind: z.literal("smart-crop-canonical-plan"),
  assetId: z.string().min(1),
  muxAssetId: z.string().optional(),
  playbackId: z.string().optional(),
  source: z.looseObject({
    width: z.number().positive(),
    height: z.number().positive(),
    durationSeconds: z.number().positive(),
  }),
  target: z.looseObject({
    aspectRatio: z.literal("9:16"),
    width: z.number().positive(),
    height: z.number().positive(),
  }),
  strategy: z
    .looseObject({
      cropMode: z.string().optional(),
      plannerVersion: z.string().optional(),
      model: z.string().optional(),
    })
    .optional(),
  segments: z.array(planSegmentSchema),
  usage: z
    .looseObject({
      inputTokens: z.number().optional(),
      outputTokens: z.number().optional(),
    })
    .optional(),
  qa: z
    .looseObject({
      status: z.enum(["draft", "approved", "rejected"]),
      approvedBy: z.string().optional(),
      approvedAt: z.string().optional(),
    })
    .optional(),
  generatedAt: z.string().optional(),
})

export type CropPlan = z.infer<typeof cropPlanSchema>
export type PlanSegment = z.infer<typeof planSegmentSchema>

const timelineMapSegmentSchema = z.looseObject({
  canonicalShotId: z.string().min(1),
  canonicalStart: z.number().min(0),
  canonicalEnd: z.number().min(0),
  localizedStart: z.number().min(0),
  localizedEnd: z.number().min(0),
  confidence: z.number().min(0).max(1),
})

export const timelineMapSchema = z.looseObject({
  version: z.literal(1),
  kind: z.literal("smart-crop-timeline-map"),
  canonicalAssetId: z.string().min(1),
  localizedAssetId: z.string().min(1),
  language: z.string().optional(),
  mappingMethod: z.enum(["identical-duration", "shot-sequence"]),
  overallConfidence: z.number().min(0).max(1),
  unmappedDurationPercent: z.number().min(0),
  maxConsecutiveUnmappedSeconds: z.number().min(0),
  segments: z.array(timelineMapSegmentSchema),
  gate: z
    .looseObject({
      passed: z.boolean(),
      failures: z.array(z.unknown()).optional(),
    })
    .optional(),
  warnings: z.array(z.string()).optional(),
  generatedAt: z.string().optional(),
})

export type TimelineMap = z.infer<typeof timelineMapSchema>

export function parseCropPlan(raw: unknown): CropPlan {
  return cropPlanSchema.parse(raw)
}

export function parseTimelineMap(raw: unknown): TimelineMap {
  return timelineMapSchema.parse(raw)
}

export type RemapResult = {
  segments: RenderSegment[]
  warnings: string[]
}

export function remapSegments(
  plan: CropPlan,
  timelineMap: TimelineMap | null,
): RemapResult {
  const warnings: string[] = []
  const segments: RenderSegment[] = []

  const localizedByShotId = new Map(
    (timelineMap?.segments ?? []).map((segment) => [
      segment.canonicalShotId,
      segment,
    ]),
  )

  for (const planSegment of plan.segments) {
    let start: number
    let end: number

    if (timelineMap) {
      const mapped = localizedByShotId.get(planSegment.shotId)
      if (!mapped) {
        warnings.push(
          `unmapped shot ${planSegment.shotId} skipped (no timeline map entry)`,
        )
        continue
      }
      start = mapped.localizedStart
      end = mapped.localizedEnd
    } else {
      start = planSegment.canonicalStart
      end = planSegment.canonicalEnd
    }

    const durationSeconds = end - start
    if (durationSeconds <= 0) {
      warnings.push(
        `shot ${planSegment.shotId} dropped (non-positive duration ${durationSeconds.toFixed(3)}s)`,
      )
      continue
    }

    segments.push({
      shotId: planSegment.shotId,
      start,
      end,
      durationSeconds,
      keyframes: planSegment.cropKeyframes.map((keyframe) => ({
        progress: keyframe.progress,
        x: keyframe.x,
        y: keyframe.y,
        width: keyframe.width,
        height: keyframe.height,
      })),
    })
  }

  return { segments, warnings }
}

export type PreviewSamplingOptions = {
  maxSegments: number
  maxSeconds: number
}

const MIN_TRUNCATED_SEGMENT_SECONDS = 0.25

export function samplePreviewSegments(
  segments: RenderSegment[],
  { maxSegments, maxSeconds }: PreviewSamplingOptions,
): RenderSegment[] {
  if (segments.length === 0) return []

  // Sample up to maxSegments evenly across the list, always including the
  // first segment. floor(i * n / k) is strictly increasing for k <= n.
  let sampled: RenderSegment[]
  if (segments.length <= maxSegments) {
    sampled = [...segments]
  } else {
    sampled = Array.from(
      { length: maxSegments },
      (_, index) =>
        segments[Math.floor((index * segments.length) / maxSegments)]!,
    )
  }

  // Trim so the summed duration stays within maxSeconds; the last included
  // segment is truncated when it only partially fits. Keyframe progress then
  // spans the truncated duration — acceptable for preview QA purposes.
  const trimmed: RenderSegment[] = []
  let totalSeconds = 0
  for (const segment of sampled) {
    const remaining = maxSeconds - totalSeconds
    if (remaining <= 0) break

    if (segment.durationSeconds <= remaining) {
      trimmed.push(segment)
      totalSeconds += segment.durationSeconds
      continue
    }

    if (remaining >= MIN_TRUNCATED_SEGMENT_SECONDS) {
      trimmed.push({
        ...segment,
        end: segment.start + remaining,
        durationSeconds: remaining,
      })
      totalSeconds += remaining
    }
    break
  }

  return trimmed
}
