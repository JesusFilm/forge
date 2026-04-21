import { z } from "zod"
import { CoreLocalizedValueSchema } from "./shared"

export const CoreLanguageSchema = z.object({
  id: z.string().min(1),
  bcp47: z.string().min(1).nullable(),
  iso3: z.string().min(1).nullable(),
  name: z.array(CoreLocalizedValueSchema),
})
