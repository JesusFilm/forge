/**
 * lookupBibleVerse tool (consolidation U8) — HTTP-backed.
 *
 * Re-homed from `apps/admin/src/mastra/tools/lookup-bible-verse.ts`. Calls
 * admin's bearer-gated `/api/internal/agent-tools/lookup-bible-verse` over HTTP
 * (R2/R7). The `query` arg naming is preserved (the prompts reference it).
 *
 * Graceful degradation: any client failure collapses to an empty `{ books: [] }`
 * so a tool outage never crashes the agent turn.
 */

import { createTool } from "@mastra/core/tools"
import { z } from "zod"

import {
  lookupBibleVerseViaAdmin,
  type AdminAgentToolsConfig,
} from "../../services/admin-agent-tools-client"

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

export const lookupBibleVerseOutputSchema = z.object({
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

export type LookupBibleVerseInput = z.input<typeof lookupBibleVerseInputSchema>
export type LookupBibleVerseOutput = z.output<
  typeof lookupBibleVerseOutputSchema
>

export async function executeLookupBibleVerse(
  input: LookupBibleVerseInput,
  options: {
    lookup?: typeof lookupBibleVerseViaAdmin
    config?: AdminAgentToolsConfig
    fetchImpl?: typeof fetch
  } = {},
): Promise<LookupBibleVerseOutput> {
  const parsed = lookupBibleVerseInputSchema.parse(input)
  const result = await (options.lookup ?? lookupBibleVerseViaAdmin)(
    { query: parsed.query, locale: parsed.locale, limit: parsed.limit },
    { config: options.config, fetchImpl: options.fetchImpl },
  )
  if (!result.ok) {
    console.error(
      `[agent-tool] event=lookup_bible_verse_unavailable reason=${result.reason}`,
    )
    return { books: [] }
  }
  return { books: result.data.books }
}

export const lookupBibleVerseTool = createTool({
  id: "lookupBibleVerse",
  description:
    "Look up Bible books by name, alternate name, OSIS id, or abbreviation. Returns bookId, localised displayName, OSIS id, testament, and canonical order. Use the returned bookId / osisId to construct bibleQuotesCarousel block references.",
  inputSchema: lookupBibleVerseInputSchema,
  outputSchema: lookupBibleVerseOutputSchema,
  execute: async (inputData) => executeLookupBibleVerse(inputData),
})
