import { z } from "zod"

export const CoreVideoSubtitleSchema = z.object({
  id: z.string().min(1),
  videoId: z.string().min(1),
  languageId: z.string().min(1),
  primary: z.boolean(),
  edition: z.string(),
  vttSrc: z.string().nullable(),
  srtSrc: z.string().nullable(),
  value: z.string(),
  updatedAt: z.string().datetime().optional(),
  videoEdition: z.object({ id: z.string().min(1) }),
})
