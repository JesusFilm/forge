/**
 * Agent-tool query + filter logic (consolidation U7).
 *
 * The load-bearing data logic the three Mastra chat tools used to run
 * in-process (`apps/admin/src/mastra/tools/*`), relocated server-side behind
 * bearer-gated `/api/internal/agent-tools/*` routes so the standalone Mastra
 * service can call them over HTTP (R7/R2). The caller (mastra) is treated as
 * UNTRUSTED — every load-bearing filter and cap is re-asserted here, never
 * relied on from the client:
 *   - search: `contentTypes:["video"]` + `playbackId !== null` (unplayable
 *     videos must never reach the agent, which writes videoIds into blocks
 *     verbatim) + field trim + `limit` cap (max 20, default 8).
 *   - bible: OR-match on osisId / paratextAbbreviation / alternateName +
 *     `orderBy {order:asc}` + locale-fallback displayName + `take` cap (max 10,
 *     default 3).
 *   - image: `VARIANT_PRIORITY` first-non-empty pick.
 *
 * Pure data functions (no auth, no HTTP) so the routes stay thin and these are
 * unit-testable with a mock Prisma + provable against a real DB (the
 * playability filter is a real-DB smoke target — mocked tests only prove branch
 * shape).
 */

import type { PrismaClient } from "@prisma/client"
import { z } from "zod"

import { HybridSearchService } from "@/services/hybrid-search.service"

// ---------------------------------------------------------------------------
// search-videos
// ---------------------------------------------------------------------------

export const SEARCH_VIDEOS_LIMIT_DEFAULT = 8
export const SEARCH_VIDEOS_LIMIT_MAX = 20

export const searchVideosRequestSchema = z.object({
  q: z.string().min(1),
  locale: z.string().min(2),
  // Re-assert the cap server-side: clamp to [1, 20], default 8, even if the
  // caller sends something larger or omits it.
  limit: z.coerce
    .number()
    .int()
    .positive()
    .max(SEARCH_VIDEOS_LIMIT_MAX)
    .default(SEARCH_VIDEOS_LIMIT_DEFAULT),
})
export type SearchVideosRequest = z.infer<typeof searchVideosRequestSchema>

export type AgentVideoResult = {
  videoId: string
  title: string
  snippet: string
  slug: string
  imageUrl: string | null
}

export async function searchVideosForAgent(
  prisma: PrismaClient,
  input: SearchVideosRequest,
): Promise<{ videos: AgentVideoResult[] }> {
  const service = new HybridSearchService({ prisma })
  const response = await service.search({
    query: input.q,
    locale: input.locale,
    limit: input.limit,
    contentTypes: ["video"],
  })

  const videos = response.results
    // playbackId === null means no playable dub resolved for the locale (the R4
    // retrievers keep such rows); agents write these videoIds into blocks
    // verbatim, so unplayable results must never reach them.
    .filter((result) => result.type === "video" && result.playbackId !== null)
    .map((result) => ({
      videoId: result.id,
      title: result.title,
      snippet: result.snippet,
      slug: result.slug,
      imageUrl: result.imageUrl,
    }))

  return { videos }
}

// ---------------------------------------------------------------------------
// lookup-bible-verse
// ---------------------------------------------------------------------------

export const LOOKUP_BIBLE_LIMIT_DEFAULT = 3
export const LOOKUP_BIBLE_LIMIT_MAX = 10

export const lookupBibleVerseRequestSchema = z.object({
  query: z.string().min(1),
  locale: z.string().min(2).default("en"),
  limit: z.coerce
    .number()
    .int()
    .positive()
    .max(LOOKUP_BIBLE_LIMIT_MAX)
    .default(LOOKUP_BIBLE_LIMIT_DEFAULT),
})
export type LookupBibleVerseRequest = z.infer<
  typeof lookupBibleVerseRequestSchema
>

export type AgentBibleBookResult = {
  bookId: string
  osisId: string | null
  displayName: string
  testament: string | null
  order: number | null
}

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

export async function lookupBibleVerseForAgent(
  prisma: Pick<PrismaClient, "bibleBook">,
  input: LookupBibleVerseRequest,
): Promise<{ books: AgentBibleBookResult[] }> {
  const q = input.query.trim()
  const books = await prisma.bibleBook.findMany({
    where: {
      deletedAt: null,
      OR: [
        { osisId: { equals: q, mode: "insensitive" } },
        { paratextAbbreviation: { equals: q, mode: "insensitive" } },
        { alternateName: { contains: q, mode: "insensitive" } },
      ],
    },
    take: input.limit,
    orderBy: { order: "asc" },
  })

  return {
    books: books.map((book) => ({
      bookId: book.id,
      osisId: book.osisId,
      displayName: pickLocalisedName(book.name, input.locale, q),
      testament: book.testament,
      order: book.order,
    })),
  }
}

// ---------------------------------------------------------------------------
// fetch-video-image
// ---------------------------------------------------------------------------

export const fetchVideoImageRequestSchema = z.object({
  videoId: z.string().min(1),
})
export type FetchVideoImageRequest = z.infer<
  typeof fetchVideoImageRequestSchema
>

export type AgentVideoImageResult = {
  imageUrl: string | null
  variant: string | null
}

const VARIANT_PRIORITY = [
  "mobileCinematicHigh",
  "videoStill",
  "thumbnail",
  "url",
] as const

export async function fetchVideoImageForAgent(
  prisma: Pick<PrismaClient, "videoImage">,
  input: FetchVideoImageRequest,
): Promise<AgentVideoImageResult> {
  const images = await prisma.videoImage.findMany({
    where: {
      videoId: input.videoId,
      deletedAt: null,
    },
    orderBy: { createdAt: "asc" },
  })

  if (images.length === 0) {
    return { imageUrl: null, variant: null }
  }

  for (const variant of VARIANT_PRIORITY) {
    for (const image of images) {
      const value = image[variant as keyof typeof image] as
        | string
        | null
        | undefined
      if (typeof value === "string" && value.length > 0) {
        return { imageUrl: value, variant }
      }
    }
  }

  return { imageUrl: null, variant: null }
}
