import { z } from "zod"

export const ReviewQueueOutcomeSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("not_configured") }).strict(),
  z.object({ status: z.literal("empty") }).strict(),
  z
    .object({
      status: z.literal("submitted"),
      inserted: z.number().int().nonnegative(),
      skipped: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({
      status: z.literal("failed"),
      reason: z.enum([
        "config_missing",
        "auth_failed",
        "upstream_failed",
        "invalid_response",
      ]),
    })
    .strict(),
])

export type ReviewQueueOutcome = z.infer<typeof ReviewQueueOutcomeSchema>
