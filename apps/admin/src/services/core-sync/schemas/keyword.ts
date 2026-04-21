import { z } from "zod"

export const CoreKeywordSchema = z.object({
  id: z.string().min(1),
  value: z.string(),
  language: z
    .object({
      id: z.string().min(1),
    })
    .nullable(),
})
