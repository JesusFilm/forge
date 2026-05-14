/**
 * lookupBibleVerse tool (U5).
 *
 * Resolves a BibleBook reference for an agent that wants to cite
 * Scripture in a draft. Returns the localised book name + the
 * canonical OSIS id so the agent can construct bibleQuotesCarousel
 * blocks correctly.
 *
 * This is a thin read against the `BibleBook` model. A future
 * iteration may add chapter+verse lookup against an external Bible
 * API, but that's beyond U5's scope — the v1 tool answers "is this
 * book real, and what's its display name in locale X?".
 *
 * ABAC posture: BibleBook is public reference data. No principal
 * check needed; the tool stays public-shape.
 */

import { createTool } from "@mastra/core/tools"
import { z } from "zod"

import { prisma } from "@/db/client"

/** Exported for unit-test access; createTool wraps this in a Standard Schema. */
export const lookupBibleVerseInputSchema = z.object({
  query: z
    .string()
    .min(1)
    .describe(
      "Book name, alternate name, OSIS id, or paratext abbreviation. Case-insensitive partial match.",
    ),
  locale: z
    .string()
    .min(2)
    .default("en")
    .describe("BCP-47 locale for the display name fallback."),
  limit: z
    .number()
    .int()
    .positive()
    .max(10)
    .default(3)
    .describe("Max matching books to return."),
})

const inputSchema = lookupBibleVerseInputSchema

const outputSchema = z.object({
  books: z.array(
    z.object({
      bookId: z.string(),
      osisId: z.string().nullable(),
      displayName: z.string(),
      testament: z.string().nullable(),
      order: z.number().int().nullable(),
    }),
  ),
})

function isNameMap(value: unknown): value is Record<string, string> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function pickLocalisedName(
  name: unknown,
  locale: string,
  fallback: string,
): string {
  if (!isNameMap(name)) return fallback
  if (typeof name[locale] === "string" && name[locale]) return name[locale]
  // Strip BCP-47 region tail and try the language base (e.g. "fr-CA" → "fr").
  const base = locale.split("-")[0]
  if (base && typeof name[base] === "string" && name[base]) return name[base]
  if (typeof name.en === "string" && name.en) return name.en
  return fallback
}

export const lookupBibleVerseTool = createTool({
  id: "lookupBibleVerse",
  description:
    "Look up Bible books by name, alternate name, OSIS id, or abbreviation. Returns bookId, localised displayName, OSIS id, testament, and canonical order. Use the returned bookId / osisId to construct bibleQuotesCarousel block references.",
  inputSchema,
  outputSchema,
  execute: async (inputData, context) => {
    void context?.requestContext
    const q = inputData.query.trim()
    const books = await prisma.bibleBook.findMany({
      where: {
        deletedAt: null,
        OR: [
          { osisId: { equals: q, mode: "insensitive" } },
          { paratextAbbreviation: { equals: q, mode: "insensitive" } },
          { alternateName: { contains: q, mode: "insensitive" } },
        ],
      },
      take: inputData.limit,
      orderBy: { order: "asc" },
    })

    return {
      books: books.map((book) => ({
        bookId: book.id,
        osisId: book.osisId,
        displayName: pickLocalisedName(book.name, inputData.locale ?? "en", q),
        testament: book.testament,
        order: book.order,
      })),
    }
  },
})
