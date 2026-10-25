import { z } from "zod"

export const CoreVideoImageSchema = z.object({
  id: z.string().min(1),
  updatedAt: z.string().min(1),
  videoId: z.string().min(1).nullable(),
  aspectRatio: z.string().nullable(),
  url: z.string().nullable(),
  mobileCinematicHigh: z.string().nullable(),
  mobileCinematicLow: z.string().nullable(),
  mobileCinematicVeryLow: z.string().nullable(),
  thumbnail: z.string().nullable(),
  videoStill: z.string().nullable(),
})
