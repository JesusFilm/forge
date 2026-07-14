/**
 * fetchVideoImage tool (consolidation U8) — HTTP-backed.
 *
 * Re-homed from `apps/admin/src/mastra/tools/fetch-video-image.ts`. Calls
 * admin's bearer-gated `/api/internal/agent-tools/fetch-video-image` over HTTP
 * (R2/R7); the VARIANT_PRIORITY pick happens admin-side.
 *
 * Graceful degradation: any client failure collapses to `{ imageUrl: null,
 * variant: null }` (the same shape "no image found" returns) so a tool outage
 * never crashes the agent turn.
 */

import { createTool } from "@mastra/core/tools"
import { z } from "zod"

import {
  fetchVideoImageViaAdmin,
  type AdminAgentToolsConfig,
} from "../../services/admin-agent-tools-client"

export const fetchVideoImageInputSchema = z.object({
  videoId: z
    .string()
    .min(1)
    .describe("The video's cuid id, as returned by searchVideos."),
})

export const fetchVideoImageOutputSchema = z.object({
  imageUrl: z.string().nullable(),
  variant: z.string().nullable(),
})

export type FetchVideoImageInput = z.input<typeof fetchVideoImageInputSchema>
export type FetchVideoImageOutput = z.output<typeof fetchVideoImageOutputSchema>

export async function executeFetchVideoImage(
  input: FetchVideoImageInput,
  options: {
    fetchImage?: typeof fetchVideoImageViaAdmin
    config?: AdminAgentToolsConfig
    fetchImpl?: typeof fetch
  } = {},
): Promise<FetchVideoImageOutput> {
  const parsed = fetchVideoImageInputSchema.parse(input)
  const result = await (options.fetchImage ?? fetchVideoImageViaAdmin)(
    { videoId: parsed.videoId },
    { config: options.config, fetchImpl: options.fetchImpl },
  )
  if (!result.ok) {
    console.error(
      `[agent-tool] event=fetch_video_image_unavailable reason=${result.reason}`,
    )
    return { imageUrl: null, variant: null }
  }
  return { imageUrl: result.data.imageUrl, variant: result.data.variant }
}

export const fetchVideoImageTool = createTool({
  id: "fetchVideoImage",
  description:
    "Get the best available image URL for a video by videoId. Returns the resolved URL and the variant name picked. Returns null when the video has no images.",
  inputSchema: fetchVideoImageInputSchema,
  outputSchema: fetchVideoImageOutputSchema,
  execute: async (inputData) => executeFetchVideoImage(inputData),
})
