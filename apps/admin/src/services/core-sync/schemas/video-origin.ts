import { z } from "zod"

export const CoreVideoOriginSchema = z.object({
  id: z.string().min(1),
  updatedAt: z.string().min(1).optional(),
  name: z.string(),
  description: z.string().nullable(),
})
