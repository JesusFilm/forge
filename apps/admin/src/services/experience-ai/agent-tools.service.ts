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

import {
  WatchSearchService,
  type WatchSearchAvailabilityKind,
} from "@/services/watch-search.service"
import { pickLocalisedName } from "./citation-reference"

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

// Since the playback-field (#1789) and availability.kind (feat-326) widenings
// this shape is a SUPERSET of the in-process twin's
// (src/mastra/tools/search-videos.ts) — the two are no longer field-identical;
// reconcile deliberately if they ever re-converge. availability is a nested
// object mirroring the upstream WatchSearchAvailability shape so later
// widening (languageSlug, audio/subtitles) is additive, not a rename.
export type AgentVideoResult = {
  videoId: string
  title: string
  snippet: string
  slug: string
  imageUrl: string | null
  playbackId: string
  durationSeconds: number | null
  languageSlug: string | null
  availability: { kind: WatchSearchAvailabilityKind }
}

export async function searchVideosForAgent(
  prisma: PrismaClient,
  input: SearchVideosRequest,
): Promise<{ videos: AgentVideoResult[] }> {
  const service = new WatchSearchService(prisma)
  const targetLanguageSlug = await languageSlugForLocale(prisma, input.locale)
  const response = await service.search({
    query: input.q,
    targetLanguageSlug,
    displayLanguageSlug: targetLanguageSlug,
    routeLanguageSlug: targetLanguageSlug,
    acceptLanguage: input.locale,
    limit: input.limit,
    resultTypes: ["video"],
  })

  // playbackId === null means no playable dub resolved for the locale (the R4
  // retrievers keep such rows); agents write these videoIds into blocks
  // verbatim, so unplayable results must never reach them. flatMap (not
  // filter+map) so the null check narrows playbackId to string.
  const videos = response.results.flatMap((result) =>
    result.type === "video" && result.playbackId !== null
      ? [
          {
            videoId: result.id,
            title: result.title,
            snippet: result.snippet ?? "",
            slug: result.slug,
            imageUrl: result.imageUrl,
            playbackId: result.playbackId,
            durationSeconds: result.durationSeconds,
            languageSlug: result.languageSlug,
            // kind only, never the whole availability object (allowlist
            // projection). Fallback kinds (target_subtitle/related_language)
            // are REPORTED, never filtered — this endpoint serves multiple
            // agent consumers; the seeker's target_audio-only rule is mastra
            // policy (feat-327). Note: the playability filter above bounds
            // today's reachable kinds to target_audio | related_language
            // (target_subtitle/unavailable watchability always carries
            // playbackId null — search-watchability.ts).
            availability: { kind: result.availability.kind },
          },
        ]
      : [],
  )

  return { videos }
}

async function languageSlugForLocale(
  prisma: PrismaClient,
  locale: string,
): Promise<string | null> {
  const language = await prisma.language.findFirst({
    where: { bcp47: locale, deletedAt: null, slug: { not: null } },
    select: { slug: true },
  })
  return language?.slug ?? null
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
