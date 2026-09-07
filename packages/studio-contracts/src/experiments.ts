import { z } from "zod"
import { studioAssetReferenceSchema, studioIdSchema } from "./index"
export const studioExperimentRequestSchema = z
  .object({
    idempotencyKey: studioIdSchema,
    kind: z.enum(["music", "voice"]),
    provider: studioIdSchema,
    model: studioIdSchema,
    language: studioIdSchema,
    prompt: z.string().min(1).max(8000),
    candidateCount: z.number().int().min(1).max(8),
    estimate: z
      .object({
        currency: z.literal("USD"),
        amountMicros: z.number().int().nonnegative().max(100000000),
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
    actualCostMicros: z.number().int().nonnegative().max(100000000),
  })
  .strict()
