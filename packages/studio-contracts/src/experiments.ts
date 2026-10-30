import { z } from "zod"
import {
  studioAssetReferenceSchema,
  studioIdSchema,
  studioPropertiesSchema,
} from "./index"
export const studioExperimentRequestSchema = z
  .object({
    idempotencyKey: studioIdSchema,
    kind: z.enum(["music", "voice"]),
    provider: studioIdSchema,
    model: studioIdSchema,
    language: studioIdSchema,
    prompt: z.string().min(1).max(8000),
    settings: studioPropertiesSchema,
    candidateCount: z.number().int().min(1).max(8),
    estimate: z
      .object({
        currency: z.literal("USD"),
        amountMicros: z.number().int().nonnegative().max(100000000).nullable(),
        basis: z.string().min(1).max(1000),
        expiresAt: z.string().datetime(),
      })
      .strict(),
    maxCostMicros: z.number().int().nonnegative().max(100000000),
    confirmed: z.literal(true),
  })
  .strict()
export const studioExperimentCandidateSchema = z
  .object({
    experimentId: studioIdSchema,
    candidateKey: studioIdSchema,
    asset: studioAssetReferenceSchema,
    providerRequestId: studioIdSchema.nullable(),
    actualCostMicros: z
      .number()
      .int()
      .nonnegative()
      .max(Number.MAX_SAFE_INTEGER)
      .nullable(),
  })
  .strict()

export const studioExperimentOutcomeSchema = z
  .object({
    status: z.enum(["WITHIN_LIMITS", "OVERRUN", "COST_UNKNOWN"]),
    actualCostMicros: z.string().regex(/^\d+$/).nullable(),
    candidateCount: z.number().int().nonnegative(),
    costExceeded: z.boolean(),
    countExceeded: z.boolean(),
  })
  .strict()

export const studioExperimentSelectionSchema = z
  .object({
    experimentId: studioIdSchema,
    candidateKey: studioIdSchema,
    idempotencyKey: studioIdSchema,
    registeredVoice: studioAssetReferenceSchema.optional(),
  })
  .strict()
export const studioExperimentDraftSchema = studioExperimentRequestSchema.omit({
  idempotencyKey: true,
  estimate: true,
  maxCostMicros: true,
  confirmed: true,
})
