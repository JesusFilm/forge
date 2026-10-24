import { z } from "zod"

export const CoreLanguageRefSchema = z.object({
  id: z.string().min(1).optional(),
  bcp47: z.string().min(1).optional().nullable(),
})

export const CoreLocalizedValueSchema = z.object({
  id: z.string().min(1).optional(),
  value: z.string(),
  primary: z.boolean().optional().nullable(),
  order: z.number().int().optional().nullable(),
  language: CoreLanguageRefSchema,
})
