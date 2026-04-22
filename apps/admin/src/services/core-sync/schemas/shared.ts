import { z } from "zod"

export const CoreLanguageRefSchema = z.object({
  id: z.string().min(1).optional(),
  bcp47: z.string().min(1).optional(),
})

export const CoreLocalizedValueSchema = z.object({
  value: z.string(),
  language: CoreLanguageRefSchema,
})
