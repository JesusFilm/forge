import { z } from "zod"
import {
  studioAssetReferenceSchema,
  studioDigestSchema,
  studioDocumentSchema,
  studioIdSchema,
} from "./index"

export const STUDIO_INSPECTION_VERSION = "shorts-output-inspection-1"
export const STUDIO_INSPECTION_LIMITS = Object.freeze({
  samples: 12,
  imageBytes: 24576,
  evidenceBytes: 450000,
  outputBytes: 128 * 1024 * 1024,
  preparationMs: 45000,
  audioSeconds: 60,
})
export const studioInspectionRequestSchema = z
  .object({ projectId: studioIdSchema, attemptId: studioIdSchema })
  .strict()
const intervalSchema = z
  .object({
    startMs: z.number().nonnegative(),
    endMs: z.number().nonnegative(),
  })
  .strict()
export const studioInspectionFindingSchema = z
  .object({
    code: z.enum([
      "authored-gap",
      "sampled-black",
      "potential-text-overflow",
      "potential-small-text",
      "audio-silence",
      "audio-near-fullscale",
      "audio-missing",
      "unsupported",
    ]),
    basis: z.enum([
      "timeline-heuristic",
      "rendered-pixels",
      "decoded-audio",
      "container",
    ]),
    message: z.string().max(1000),
    itemId: studioIdSchema.optional(),
    startMs: z.number().nonnegative().optional(),
    endMs: z.number().nonnegative().optional(),
  })
  .strict()
export const studioInspectionEvidenceSchema = studioInspectionRequestSchema
  .extend({
    version: z.literal(STUDIO_INSPECTION_VERSION),
    revision: z.number().int().positive(),
    inputHash: studioDigestSchema,
    output: studioAssetReferenceSchema,
    durationMs: z.number().positive(),
    outputReadyAt: z.iso.datetime(),
    preparationStartedAt: z.iso.datetime(),
    evidenceReadyAt: z.iso.datetime(),
    preparationMs: z.number().nonnegative(),
    status: z.enum(["sampled", "incomplete", "unsupported"]),
    advisoryOnly: z.literal(true),
    samples: z
      .array(
        z
          .object({
            frame: z.number().int().nonnegative(),
            timestampMs: z.number().nonnegative(),
            reasons: z
              .array(z.enum(["representative", "before-cut", "after-cut"]))
              .min(1)
              .max(3),
            blackPercent: z.number().min(0).max(100).nullable(),
            image: z
              .object({
                mimeType: z.literal("image/jpeg"),
                data: z
                  .string()
                  .max(32768)
                  .regex(/^[A-Za-z0-9+/]*={0,2}$/),
                digest: studioDigestSchema,
              })
              .strict(),
          })
          .strict(),
      )
      .max(STUDIO_INSPECTION_LIMITS.samples),
    coverage: z
      .object({
        totalFrames: z.number().int().positive(),
        requestedFrames: z
          .array(z.number().int().nonnegative())
          .max(STUDIO_INSPECTION_LIMITS.samples),
        cutCount: z.number().int().nonnegative(),
        sampledCutCount: z.number().int().nonnegative(),
        authoredGaps: z.array(intervalSchema).max(1001),
        gapIntent: z.literal(
          "not-recorded; confirm intentional gaps with the author",
        ),
        audio: z
          .object({
            status: z.enum(["measured", "missing", "unavailable"]),
            startMs: z.literal(0),
            endMs: z.number().nonnegative(),
            monoSampleRate: z.literal(8000),
            rms: z.number().nonnegative().nullable(),
            peak: z.number().nonnegative().nullable(),
            nearFullscaleFraction: z.number().min(0).max(1).nullable(),
            silence: z.array(intervalSchema).max(120),
          })
          .strict(),
      })
      .strict(),
    findings: z.array(studioInspectionFindingSchema).max(1100),
    limitations: z.array(z.string().max(1000)).min(1).max(20),
    toolchain: z
      .object({ ffmpeg: z.string().max(300), ffprobe: z.string().max(300) })
      .strict(),
  })
  .strict()
  .refine(
    (v) =>
      new TextEncoder().encode(JSON.stringify(v)).length <=
      STUDIO_INSPECTION_LIMITS.evidenceBytes,
    "Inspection evidence exceeds byte budget",
  )
  .refine(
    (v) =>
      v.status !== "sampled" ||
      (v.samples.length > 0 &&
        v.samples.length === v.coverage.requestedFrames.length &&
        v.samples.every((s) => v.coverage.requestedFrames.includes(s.frame))),
    "Sampled evidence requires every requested actual image",
  )

export type StudioInspectionEvidence = z.infer<
  typeof studioInspectionEvidenceSchema
>
export type StudioInspectionFinding = z.infer<
  typeof studioInspectionFindingSchema
>
export const studioInspectionContextSchema = studioInspectionRequestSchema
  .extend({
    revision: z.number().int().positive(),
    currentRevision: z.number().int().positive(),
    stale: z.boolean(),
    inputHash: studioDigestSchema,
    output: studioAssetReferenceSchema,
    document: studioDocumentSchema,
    outputReadyAt: z.iso.datetime(),
    evidence: studioInspectionEvidenceSchema.nullable(),
  })
  .strict()
export type StudioInspectionContext = z.infer<
  typeof studioInspectionContextSchema
>
