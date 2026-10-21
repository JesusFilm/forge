import { z } from "zod"

/** Persisted subscription identities; never rewrite historical rows. */
export const subscriptionModelIdSchema = z.enum(["gpt-6-astra", "gpt-6.1-sol"])
