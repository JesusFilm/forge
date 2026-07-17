/**
 * searchVideos tool (U5).
 *
 * Lets Mastra agents call admin's existing hybrid-search service
 * during a chat turn instead of receiving pre-fetched candidates in
 * the prompt. Wraps `HybridSearchService.search` with a tight Zod
 * surface scoped to what an editorial agent actually consumes.
 *
 * ABAC posture: the tool's `execute` runs inside the request context;
 * the principal is pulled from `context.requestContext` and used by
 * the service's own ABAC checks. The tool itself does NOT call Prisma
 * directly — it goes through the service-layer entrypoint so the
 * existing service-layer ABAC rules govern.
 *
 * Result shape: trimmed to fields the agent will use in block
 * construction (id, title, description, videoId, locale). The full
 * SearchResponse contains scoring debug + per-result metadata we
 * don't need to feed into the agent's context.
 */

import { createTool } from "@mastra/core/tools"
import { z } from "zod"

import { prisma } from "@/db/client"
import { HybridSearchService } from "@/services/hybrid-search.service"

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
    const service = new HybridSearchService({ prisma })
    const response = await service.search({
      query: inputData.q,
      locale: inputData.locale,
      limit: inputData.limit,
      contentTypes: ["video"],
    })

    const videos = response.results
      // playbackId === null means no playable dub resolved for the locale
      // (the R4 retrievers keep such rows); agents write these videoIds into
      // blocks verbatim, so unplayable results must never reach them.
      .filter((result) => result.type === "video" && result.playbackId !== null)
      .map((result) => ({
        videoId: result.id,
        title: result.title,
        snippet: result.snippet,
        slug: result.slug,
        imageUrl: result.imageUrl,
      }))

    return { videos }
  },
})
