import { z } from "zod"

/** Validated JESUS-film catalog selected from the devotional Workspace. */
export const JesusFilmChapterSchema = z
  .object({
    index: z.number().int().positive(),
    id: z.string().trim().min(1),
    title: z.string().trim().min(1),
    start: z.string().regex(/^\d+:\d{2}:\d{2}$/),
  })
  .strict()

const JesusFilmCatalogSchema = z
  .object({ chapters: z.array(JesusFilmChapterSchema).min(1).max(10_000) })
  .strict()
  .superRefine(({ chapters }, context) => {
    const indices = new Set<number>()
    const ids = new Set<string>()
    for (const [position, chapter] of chapters.entries()) {
      if (chapter.index !== position + 1) {
        context.addIssue({
          code: "custom",
          path: ["chapters", position, "index"],
          message: "chapter indices must be contiguous and ordered",
        })
      }
      if (indices.has(chapter.index) || ids.has(chapter.id)) {
        context.addIssue({
          code: "custom",
          path: ["chapters", position],
          message: "chapter indices and ids must be unique",
        })
      }
      indices.add(chapter.index)
      ids.add(chapter.id)
    }
  })

export type JesusFilmChapter = z.infer<typeof JesusFilmChapterSchema>

export function parseJesusFilmCatalogDocument(options: {
  path: string
  content: string
}): readonly JesusFilmChapter[] {
  try {
    return JesusFilmCatalogSchema.parse(JSON.parse(options.content)).chapters
  } catch (error) {
    throw new Error(`${options.path}: invalid JESUS-film catalog`, {
      cause: error,
    })
  }
}

export const _internal = { JesusFilmCatalogSchema }
