import { z } from "zod"
import {
  studioDigestSchema,
  studioIdSchema,
  studioCommandBaseSchema,
} from "./index"
import { studioPreviewSchema } from "./preview"

/** Worker/pool identity is supplied by the authenticated broker configuration;
 * only dispatchId originates in the VM's durable pre-request journal. */
export const studioRenderAssignmentSchema = z
  .object({
    poolId: studioIdSchema,
    workerId: studioIdSchema,
    dispatchId: z.uuid(),
  })
  .strict()

/** Versioned execution contract. Changing a bound requires a new profile ID. */
export const STUDIO_RENDER_PROFILE_V1 = Object.freeze({
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

/** Retained v2 descriptor, unchanged for history and terminal settlements. */
export const STUDIO_RENDER_PROFILE_V2 = Object.freeze({
  ...STUDIO_RENDER_PROFILE_V1,
  id: "studio-render-2/1200s-180prep-2cpu-2g-128p-96child-128m",
  jobMs: 1200000,
  requestMs: 1220000,
  leaseMs: 1500000,
  preparationMs: 180000,
} as const)

/** Retained full-project serial descriptor; never reinterpret issued jobs. */
export const STUDIO_RENDER_PROFILE_V3 = Object.freeze({
  ...STUDIO_RENDER_PROFILE_V2,
  id: "studio-render-3/3600s-180prep-2cpu-2g-128p-96child-128m",
  jobMs: 3600000,
  requestMs: 3620000,
  leaseMs: 3900000,
} as const)

/** Parallel CPU worker profile for the dedicated jfpai01 guest. */
export const STUDIO_RENDER_PROFILE = Object.freeze({
  ...STUDIO_RENDER_PROFILE_V3,
  id: "studio-render-4/3600s-180prep-24cpu-32g-4096p-4096child-128m",
  cpu: 24,
  memoryBytes: 34359738368,
  aggregatePids: 4096,
  childPids: 4096,
} as const)

export const studioRenderExecutionProfileSchema = z
  .record(z.string(), z.union([z.string(), z.number()]))
  .refine(
    (value) =>
      [
        STUDIO_RENDER_PROFILE_V1,
        STUDIO_RENDER_PROFILE_V2,
        STUDIO_RENDER_PROFILE_V3,
        STUDIO_RENDER_PROFILE,
      ].some(
        (profile) =>
          Object.keys(value).length === Object.keys(profile).length &&
          Object.entries(profile).every(
            ([key, expected]) => value[key] === expected,
          ),
      ),
    "Unsupported immutable render profile",
  )

export const STUDIO_RENDER_INPUT_BYTES = 128 * 1024 * 1024
export const STUDIO_RENDER_WIRE_BYTES = 180 * 1024 * 1024
/** Each upload stays below the edge request limit, including base64 expansion. */
export const STUDIO_RENDER_OUTPUT_PART_BYTES = 16 * 1024 * 1024
export const STUDIO_RENDER_OUTPUT_MAX_PARTS = 8
export const studioRenderOutputPartSchema = z
  .object({
    index: z
      .number()
      .int()
      .min(0)
      .max(STUDIO_RENDER_OUTPUT_MAX_PARTS - 1),
    count: z.number().int().min(1).max(STUDIO_RENDER_OUTPUT_MAX_PARTS),
    byteSize: z.number().int().positive().max(STUDIO_RENDER_OUTPUT_PART_BYTES),
    totalBytes: z
      .number()
      .int()
      .positive()
      .max(STUDIO_RENDER_PROFILE.outputBytes),
    outputDigest: studioDigestSchema,
    retentionDeadlineMs: z.number().int().positive().safe(),
  })
  .strict()
  .refine(
    (part) =>
      part.count ===
        Math.ceil(part.totalBytes / STUDIO_RENDER_OUTPUT_PART_BYTES) &&
      part.index < part.count &&
      part.byteSize ===
        Math.min(
          STUDIO_RENDER_OUTPUT_PART_BYTES,
          part.totalBytes - part.index * STUDIO_RENDER_OUTPUT_PART_BYTES,
        ),
    "Invalid bounded output part",
  )
function renderAdmissionSchema<const ProfileId extends string>(
  profileId: ProfileId,
) {
  return z
    .object({
      version: z.literal(1),
      profileId: z.literal(profileId),
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
        ctx.addIssue({
          code: "custom",
          message: "Invalid render file inventory",
        })
      if (Object.values(input.input.media).some((m) => !names.has(m.file)))
        ctx.addIssue({ code: "custom", message: "Missing admitted media" })
    })
}

export const studioRenderAdmissionSchema = renderAdmissionSchema(
  STUDIO_RENDER_PROFILE.id,
)
/** Serial HTTP executor retains its original immutable admission contract. */
export const studioRenderLegacyAdmissionSchema = renderAdmissionSchema(
  STUDIO_RENDER_PROFILE_V3.id,
)
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

/** Delegated callers select a revision, never execution code, URLs or worker authority. */
export const studioDraftRenderRequestSchema = studioCommandBaseSchema.strict()
export const studioDraftRenderIdentitySchema = z
  .object({
    projectId: studioIdSchema,
    attemptId: studioIdSchema,
  })
  .strict()
