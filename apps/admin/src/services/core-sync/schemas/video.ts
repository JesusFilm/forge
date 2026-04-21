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
  updatedAt: z.string().min(1),
})
