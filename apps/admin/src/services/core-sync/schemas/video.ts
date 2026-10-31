import { z } from "zod"
import { CoreLocalizedValueSchema } from "./shared"

export const CoreVideoSchema = z.object({
  id: z.string().min(1),
  slug: z.string().min(1),
  label: z.string().nullable(),
  publishedAt: z.string().min(1).nullable(),
  primaryLanguageId: z.string().min(1).nullable(),
  source: z.string().nullable(),
  origin: z
    .object({
      id: z.string().min(1),
    })
    .nullable(),
  title: z.array(CoreLocalizedValueSchema),
  description: z.array(CoreLocalizedValueSchema),
  snippet: z.array(CoreLocalizedValueSchema),
  studyQuestions: z.array(
    CoreLocalizedValueSchema.extend({ id: z.string().min(1) }),
  ),
  imageAlt: z.array(CoreLocalizedValueSchema),
  bibleCitations: z.array(
    z.object({
      id: z.string().min(1),
      osisId: z.string().nullable(),
      chapterStart: z.number().int().nullable(),
      chapterEnd: z.number().int().nullable(),
      verseStart: z.number().int().nullable(),
      verseEnd: z.number().int().nullable(),
      order: z.number().int().nullable(),
      bibleBook: z.object({
        id: z.string().min(1),
        osisId: z.string().nullable(),
      }),
    }),
  ),
  keywords: z.array(z.object({ id: z.string().min(1) })),
  children: z.array(z.object({ id: z.string().min(1) })),
  locked: z.boolean(),
  noIndex: z.boolean(),
  restrictViewPlatforms: z.array(z.string()),
  updatedAt: z.string().min(1),
})

export const CoreBibleBookSchema = z.object({
  id: z.string().min(1),
  osisId: z.string().nullable(),
  alternateName: z.string().nullable(),
  paratextAbbreviation: z.string().nullable(),
  isNewTestament: z.boolean().nullable(),
  order: z.number().int().nullable(),
  name: z.array(CoreLocalizedValueSchema),
})
