import { z } from "zod"
import { CoreLocalizedValueSchema } from "./shared"

export const CoreCountrySchema = z.object({
  id: z.string().min(1),
  name: z.array(CoreLocalizedValueSchema),
  population: z.number().int().nullable(),
  latitude: z.number().nullable(),
  longitude: z.number().nullable(),
  flagPngSrc: z.string().nullable(),
  flagWebpSrc: z.string().nullable(),
  continent: z
    .object({
      id: z.string().min(1),
      name: z.array(CoreLocalizedValueSchema),
    })
    .nullable(),
})
