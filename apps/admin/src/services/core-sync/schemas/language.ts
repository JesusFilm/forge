import { z } from "zod"
import { CoreLocalizedValueSchema } from "./shared"

const nullableNonEmptyString = z.preprocess(
  (value) => (value === "" ? null : value),
  z.string().min(1).nullable(),
)

export const CoreLanguageSchema = z.object({
  id: z.string().min(1),
  bcp47: nullableNonEmptyString,
  iso3: nullableNonEmptyString,
  slug: nullableNonEmptyString,
  name: z.array(CoreLocalizedValueSchema),
  audioPreview: z
    .object({
      value: z.string().nullable(),
      duration: z.number().int().nullable(),
      size: z.union([z.string(), z.number().int()]).nullable(),
      bitrate: z.number().int().nullable(),
      codec: z.string().nullable(),
    })
    .nullable(),
})
