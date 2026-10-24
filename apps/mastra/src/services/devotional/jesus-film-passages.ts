import { z } from "zod"

import { MUSIC_MOOD_IDS, type MusicMoodId } from "./authored-data"
import type { JesusFilmChapter } from "./jesus-film-catalog"

export const ChapterPassageSchema = z
  .object({
    index: z.number().int().positive(),
    osisRef: z.string().trim().min(1),
    reference: z.string().trim().min(1),
    mood: z.enum(MUSIC_MOOD_IDS),
    themes: z.array(z.string().trim().min(1)).min(1).max(32),
    clipStartSec: z.number().nonnegative().optional(),
    clipLengthSec: z.number().positive().optional(),
  })
  .strict()
  .refine(
    (value) => (value.clipStartSec == null) === (value.clipLengthSec == null),
    { message: "clipStartSec and clipLengthSec must be provided together" },
  )

const PassageMapSchema = z
  .object({ passages: z.array(ChapterPassageSchema).min(1).max(10_000) })
  .strict()
  .superRefine(({ passages }, context) => {
    const indices = new Set<number>()
    for (const [position, passage] of passages.entries()) {
      if (indices.has(passage.index)) {
        context.addIssue({
          code: "custom",
          path: ["passages", position, "index"],
          message: "passage index must be unique",
        })
      }
      indices.add(passage.index)
    }
  })

export type ChapterPassage = Omit<
  z.infer<typeof ChapterPassageSchema>,
  "mood"
> & { mood: MusicMoodId }

export function parseJesusFilmPassagesDocument(options: {
  path: string
  content: string
}): ChapterPassage[] {
  try {
    return PassageMapSchema.parse(JSON.parse(options.content)).passages
  } catch (error) {
    throw new Error(`${options.path}: invalid JESUS-film passage map`, {
      cause: error,
    })
  }
}

function byIndex(passages: readonly ChapterPassage[]) {
  return new Map(passages.map((passage) => [passage.index, passage]))
}

export function passageForChapter(
  index: number,
  passages: readonly ChapterPassage[],
): ChapterPassage | null {
  return byIndex(passages).get(index) ?? null
}

export type ChapterWithPassage = ChapterPassage & {
  id: string
  title: string
  start: string
}

export function chapterWithPassage(
  index: number,
  passages: readonly ChapterPassage[],
  chapters: readonly JesusFilmChapter[],
): ChapterWithPassage | null {
  const passage = passageForChapter(index, passages)
  const chapter = chapters.find((candidate) => candidate.index === index)
  if (!passage || !chapter) return null
  return {
    ...passage,
    id: chapter.id,
    title: chapter.title,
    start: chapter.start,
  }
}

export function mappedChapterIndices(
  passages: readonly ChapterPassage[],
): number[] {
  return passages.map((passage) => passage.index)
}

export const _internal = { PassageMapSchema }
