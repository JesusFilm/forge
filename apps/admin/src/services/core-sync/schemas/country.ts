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
  languageCount: z.number().int().nullable(),
  languageHavingMediaCount: z.number().int().nullable(),
  continent: z
    .object({
      id: z.string().min(1),
      name: z.array(CoreLocalizedValueSchema),
    })
    .nullable(),
  countryLanguages: z.array(
    z.object({
      id: z.string().min(1),
      speakers: z.number().int().nullable(),
      displaySpeakers: z
        .union([z.string(), z.number().int()])
        .nullable()
        .transform((value) => (value == null ? null : String(value))),
      primary: z.boolean().nullable(),
      suggested: z.boolean().nullable(),
      order: z.number().int().nullable(),
      language: z.object({ id: z.string().min(1) }),
    }),
  ),
})
