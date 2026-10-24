import { z } from "zod"

export const CoreDubDownloadSchema = z.object({
  id: z.string().min(1),
  updatedAt: z.string().min(1),
  videoVariantId: z.string().min(1).nullable(),
  quality: z.string().nullable(),
  size: z.number().nullable(),
  height: z.number().int().nullable(),
  width: z.number().int().nullable(),
  bitrate: z.number().int().nullable(),
  url: z.string().nullable(),
})
