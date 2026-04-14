import { z } from "zod"

export const CoreDubSchema = z.object({
  id: z.string().min(1),
  videoId: z.string().min(1),
  slug: z.string().nullable(),
  language: z
    .object({
      id: z.string().min(1),
    })
    .nullable(),
  duration: z.number().int(),
  lengthInMilliseconds: z.union([z.string(), z.number().int()]).nullable(),
  hls: z.string().nullable(),
  dash: z.string().nullable(),
  share: z.string().nullable(),
  downloadable: z.boolean(),
  published: z.boolean(),
  updatedAt: z.string().min(1),
})
