import { z } from "zod"

export const CoreVideoEditionSchema = z.object({
  id: z.string().min(1),
  name: z.string().nullable(),
  updatedAt: z.string().min(1).optional(),
})
