import { z } from "zod"

import { DEVOTIONAL_INPUT_CATEGORIES } from "./schemas"

export const MAX_DEVOTIONAL_ATTEMPT_STATE_BYTES = 128 * 1024

export const DevotionalSourceRefSchema = z
  .object({
    path: z.string().startsWith("/inputs/"),
    category: z.enum(DEVOTIONAL_INPUT_CATEGORIES),
    digest: z.string().regex(/^[a-f0-9]{64}$/u),
    size: z.number().int().nonnegative(),
    modifiedAt: z.string().datetime(),
    etag: z.string().optional(),
    title: z.string().min(1).max(500),
  })
  .strict()

export type DevotionalSourceRef = z.infer<typeof DevotionalSourceRefSchema>

export const DevotionalAttemptSchema = z
  .object({
    id: z.string().min(1),
    parentRunId: z.string().min(1),
    attemptNumber: z.number().int().positive(),
    idempotencyKey: z.string().min(1).max(200),
    requestHash: z.string().regex(/^[a-f0-9]{64}$/u),
    provisioningState: z.enum(["provisioning", "ready", "started", "failed"]),
    catalogGeneration: z.number().int().positive().optional(),
    runId: z.string().min(1).optional(),
    selectedSources: z.array(DevotionalSourceRefSchema).max(500),
    failureReason: z.string().max(2_000).optional(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict()

export type DevotionalAttempt = z.infer<typeof DevotionalAttemptSchema>

export function assertBoundedAttemptState<T>(state: T): T {
  const bytes = Buffer.byteLength(JSON.stringify(state))
  if (bytes > MAX_DEVOTIONAL_ATTEMPT_STATE_BYTES) {
    throw new Error(
      `Devotional attempt exceeded bounded state limit: ${bytes} > ${MAX_DEVOTIONAL_ATTEMPT_STATE_BYTES}`,
    )
  }
  return state
}
