/**
 * searchVideos tool (U5).
 *
 * Lets Mastra agents call admin's watch-search service
 * during a chat turn instead of receiving pre-fetched candidates in
 * the prompt. Wraps `WatchSearchService.search` with a tight Zod
 * surface scoped to what an editorial agent actually consumes.
 *
 * ABAC posture: the tool's `execute` runs inside the request context;
 * the principal is pulled from `context.requestContext` and used by
 * the service's own ABAC checks. The tool itself does NOT call Prisma
 * directly — it goes through the service-layer entrypoint so the
 * existing service-layer ABAC rules govern.
 *
 * Result shape: trimmed to the fields agents need for block construction and
 * playback-aware decisions. The full SearchResponse contains scoring debug
 * and per-result metadata we do not feed into the agent's context.
 */

import { createTool } from "@mastra/core/tools"
import { z } from "zod"

import { prisma } from "@/db/client"
import { WatchSearchService } from "@/services/watch-search.service"

/** Exported for unit-test access; createTool wraps this in a Standard Schema. */
export const searchVideosInputSchema = z.object({
  q: z.string().min(1).describe("Editor's free-text search query."),
  locale: z
    .string()
    .min(2)
    .describe('BCP-47 locale (e.g. "en", "es", "fr-CA").'),
  limit: z
    .number()
    .int()
    .positive()
    .max(20)
    .default(8)
    .describe("Max results to return."),
})

const inputSchema = searchVideosInputSchema

const outputSchema = z.object({
  videos: z.array(
    z.object({
      videoId: z.string(),
      title: z.string(),
      snippet: z.string(),
      slug: z.string(),
      imageUrl: z.string().nullable(),
      playbackId: z.string(),
      durationSeconds: z.number().nullable(),
      languageSlug: z.string().nullable(),
      availability: z.object({
        kind: z.string(),
        languageSlug: z.string().nullable(),
      }),
    }),
  ),
})

export const searchVideosTool = createTool({
  id: "searchVideos",
  description:
    "Search the JesusFilm video library for videos matching the editor's intent. Returns videoIds, titles, descriptions, and slugs. Use the returned videoId values verbatim in block videoId fields — never invent ids.",
  inputSchema,
  outputSchema,
  execute: async (inputData, context) => {
    void context?.requestContext // principal pulled here when service-layer ABAC needs it
    const service = new WatchSearchService(prisma)
    const targetLanguageSlug = await languageSlugForLocale(inputData.locale)
    const response = await service.search({
      query: inputData.q,
      targetLanguageSlug,
      displayLanguageSlug: targetLanguageSlug,
      routeLanguageSlug: targetLanguageSlug,
      acceptLanguage: inputData.locale,
      limit: inputData.limit,
      resultTypes: ["video"],
    })

    // flatMap keeps the non-null playback check and projection in one branch,
    // so the returned agent contract cannot accidentally claim playability
    // without the playback id that proves it.
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
              languageSlug:
                result.action?.hrefLanguageSlug ?? result.languageSlug,
              availability: {
                kind: result.availability.kind,
                languageSlug: result.availability.languageSlug,
              },
            },
          ]
        : [],
    )

    return { videos }
  },
})

async function languageSlugForLocale(locale: string): Promise<string | null> {
  const language = await prisma.language.findFirst({
    where: { bcp47: locale, deletedAt: null, slug: { not: null } },
    select: { slug: true },
  })
  return language?.slug ?? null
}
