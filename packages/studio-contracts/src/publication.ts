import { z } from "zod"
import { studioCommandBaseSchema, studioIdSchema } from "./index"

/** An existing schedule authorizes one exact delivery. A transport cannot
 * manufacture interactive authority by submitting this binding. */
export const studioSchedulePublicationBindingSchema = z
  .object({
    scheduleId: studioIdSchema,
    version: z.number().int().positive(),
    dueAt: z.iso.datetime(),
    latestAllowedAt: z.iso.datetime(),
  })
  .strict()
  .refine(
    (value) => Date.parse(value.latestAllowedAt) >= Date.parse(value.dueAt),
    "Invalid delivery window",
  )

export const studioPublishSchema = studioCommandBaseSchema.extend({
  approvalId: studioIdSchema,
  renderAttemptId: studioIdSchema,
  releaseId: studioIdSchema,
  readinessId: studioIdSchema,
  schedule: studioSchedulePublicationBindingSchema.optional(),
})
export type StudioPublish = z.infer<typeof studioPublishSchema>
export type StudioSchedulePublicationBinding = z.infer<
  typeof studioSchedulePublicationBindingSchema
>
export const studioPublicationFailureSchema = z.enum([
  "NOT_DUE",
  "CANCELLED",
  "STALE_BINDING",
  "APPROVAL_REQUIRED",
  "UNREADY",
  "ALREADY_CONSUMED",
  "AUTHORIZATION_REVOKED",
  "DELIVERY_EXPIRED",
])
export type StudioPublicationFailure = z.infer<
  typeof studioPublicationFailureSchema
>
