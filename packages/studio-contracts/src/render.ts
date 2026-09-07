import { z } from "zod"
import { studioDigestSchema, studioIdSchema } from "./index"
import { studioPreviewSchema } from "./preview"

/** Versioned execution contract. Changing a bound requires a new profile ID. */
export const STUDIO_RENDER_PROFILE = Object.freeze({
  id: "studio-render-1/900s-2cpu-2g-128p-96child-128m",
  jobMs: 900000,
  uploadMs: 10000,
  nativeCleanupMs: 1000,
  retirementMs: 2000,
  requestMs: 920000,
  leaseMs: 1200000,
  preparationMs: 90000,
  retentionMs: 60000,
  retentionTransferMs: 45000,
  terminalRecordingMs: 15000,
  cpu: 2,
  memoryBytes: 2147483648,
  swapBytes: 0,
  aggregatePids: 128,
  childPids: 96,
  outputBytes: 134217728,
} as const)

export const STUDIO_RENDER_INPUT_BYTES = 128 * 1024 * 1024
export const STUDIO_RENDER_WIRE_BYTES = 180 * 1024 * 1024
export const studioRenderAdmissionSchema = z
  .object({
    version: z.literal(1),
    profileId: z.literal(STUDIO_RENDER_PROFILE.id),
    executionExpiresAt: z.number().int().positive(),
    instanceId: z.string().uuid(),
    attemptId: studioIdSchema,
    leaseId: z.string().uuid(),
    inputHash: studioDigestSchema,
    issuedAt: z.number().int().nonnegative(),
    expiresAt: z.number().int().positive(),
    input: studioPreviewSchema,
    files: z
      .array(
        z
          .object({
            name: z.string().regex(/^[a-zA-Z0-9_-][a-zA-Z0-9._-]{0,159}$/),
            digest: studioDigestSchema,
            size: z.number().int().min(1).max(STUDIO_RENDER_INPUT_BYTES),
            base64: z
              .string()
              .max(Math.ceil(STUDIO_RENDER_INPUT_BYTES / 3) * 4),
          })
          .strict(),
      )
      .max(256),
  })
  .strict()
  .superRefine((input, ctx) => {
    const names = new Set(input.files.map((f) => f.name))
    if (
      names.size !== input.files.length ||
      names.has("input.json") ||
      input.files.reduce((n, f) => n + f.size, 0) > STUDIO_RENDER_INPUT_BYTES
    )
      ctx.addIssue({ code: "custom", message: "Invalid render file inventory" })
    if (Object.values(input.input.media).some((m) => !names.has(m.file)))
      ctx.addIssue({ code: "custom", message: "Missing admitted media" })
  })
export type StudioRenderAdmission = z.infer<typeof studioRenderAdmissionSchema>

export const STUDIO_CODEC_VERIFIER_VERSION =
  "studio-codec-1/ffmpeg-n9.0.1-27-g9b0578816c-20260907"
export const studioCodecProofSchema = z
  .object({
    version: z.literal(1),
    verifierVersion: z.literal(STUDIO_CODEC_VERIFIER_VERSION),
    outputDigest: studioDigestSchema,
    decoded: z.literal(true),
    video: z
      .object({
        codec: z.literal("h264"),
        width: z.number().int().positive(),
        height: z.number().int().positive(),
        fps: z.number().positive(),
        frames: z.number().int().positive(),
        durationMs: z.number().positive(),
      })
      .strict(),
    audio: z
      .object({
        codec: z.literal("aac"),
        sampleRate: z.literal(48000),
        channels: z.union([z.literal(1), z.literal(2)]),
        durationMs: z.number().positive(),
      })
      .strict(),
  })
  .strict()
export type StudioCodecProof = z.infer<typeof studioCodecProofSchema>
