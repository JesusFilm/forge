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
      name: z.string(),
      description: z.string().nullable(),
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
  images: z.array(
    z.object({
      id: z.string().min(1),
      aspectRatio: z.string().nullable(),
      mobileCinematicHigh: z.string().nullable(),
      mobileCinematicLow: z.string().nullable(),
      mobileCinematicVeryLow: z.string().nullable(),
      thumbnail: z.string().nullable(),
      videoStill: z.string().nullable(),
      blurhash: z.string().nullable(),
      url: z.string().nullable(),
    }),
  ),
  subtitles: z.array(
    z.object({
      id: z.string().min(1),
      primary: z.boolean().nullable(),
      vttSrc: z.string().nullable(),
      srtSrc: z.string().nullable(),
      value: z.string().nullable(),
      language: z.object({ id: z.string().min(1) }).nullable(),
      videoEdition: z
        .object({
          id: z.string().min(1),
          name: z.string().nullable(),
        })
        .nullable(),
    }),
  ),
  children: z.array(z.object({ id: z.string().min(1) })),
  locked: z.boolean(),
  noIndex: z.boolean(),
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
