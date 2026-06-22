/**
 * searchVideos tool (consolidation U8) — HTTP-backed.
 *
 * Re-homed from `apps/admin/src/mastra/tools/search-videos.ts`. Instead of
 * calling admin Prisma in-process, this calls admin's bearer-gated
 * `/api/internal/agent-tools/search-videos` over HTTP (R2/R7) via
 * `admin-agent-tools-client`. The agent-facing Zod input/output is preserved
 * (the `q` arg naming is deliberate — the prompts reference it).
 *
 * Graceful degradation: any client failure (unconfigured, auth, timeout, 5xx,
 * parse) collapses to an EMPTY result so a tool outage never crashes the agent
 * turn — the agent simply proceeds without search results. The full reason goes
 * to logs only (enum values, never the query/key/body).
 */

import { createTool } from "@mastra/core/tools"
import { z } from "zod"

import {
  searchVideosViaAdmin,
  type AdminAgentToolsConfig,
} from "../../services/admin-agent-tools-client"

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

export const searchVideosOutputSchema = z.object({
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

export type SearchVideosInput = z.input<typeof searchVideosInputSchema>
export type SearchVideosOutput = z.output<typeof searchVideosOutputSchema>

export async function executeSearchVideos(
  input: SearchVideosInput,
  options: {
    search?: typeof searchVideosViaAdmin
    config?: AdminAgentToolsConfig
    fetchImpl?: typeof fetch
  } = {},
): Promise<SearchVideosOutput> {
  const parsed = searchVideosInputSchema.parse(input)
  const result = await (options.search ?? searchVideosViaAdmin)(
    { q: parsed.q, locale: parsed.locale, limit: parsed.limit },
    { config: options.config, fetchImpl: options.fetchImpl },
  )
  if (!result.ok) {
    console.error(
      `[agent-tool] event=search_videos_unavailable reason=${result.reason}`,
    )
    return { videos: [] }
  }
  return { videos: result.data.videos }
}

export const searchVideosTool = createTool({
  id: "searchVideos",
  description:
    "Search the JesusFilm video library for videos matching the editor's intent. Returns videoIds, titles, descriptions, and slugs. Use the returned videoId values verbatim in block videoId fields — never invent ids.",
  inputSchema: searchVideosInputSchema,
  outputSchema: searchVideosOutputSchema,
  execute: async (inputData) => executeSearchVideos(inputData),
})
