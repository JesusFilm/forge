import { z } from "zod"
import { CoreLocalizedValueSchema } from "./shared"

export const CoreVideoSchema = z.object({
  id: z.string().min(1),
  slug: z.string().min(1),
  label: z.string().nullable(),
  primaryLanguageId: z.string().min(1).nullable(),
  title: z.array(CoreLocalizedValueSchema),
  description: z.array(CoreLocalizedValueSchema),
  snippet: z.array(CoreLocalizedValueSchema),
  imageAlt: z.array(CoreLocalizedValueSchema),
  locked: z.boolean(),
  noIndex: z.boolean(),
  // ISO-8601 datetime — strict parse so a malformed Core timestamp
  // drops the row at parse time (counted as parse-error in the phase
  // stats) rather than reaching `new Date(updatedAt)` and binding
  // Invalid Date to a TIMESTAMPTZ column. With bulk INSERTs a single
  // bad row would otherwise abort the entire 500-row page.
  updatedAt: z.string().datetime(),
})
