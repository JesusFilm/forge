import { z } from "zod"

/** Explicit subscription models; Astra remains the default for old callers. */
export const subscriptionModelIdSchema = z.enum(["gpt-6-astra", "gpt-6.1-sol"])
export type SubscriptionModelId = z.infer<typeof subscriptionModelIdSchema>
