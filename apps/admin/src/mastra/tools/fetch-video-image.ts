/**
 * fetchVideoImage tool (U5).
 *
 * Returns a usable image URL for a video, picking the highest-fidelity
 * variant available. Used by:
 *   - Draft-experience agent populating videoHero / mediaCollection
 *     items with imageUrl references at draft time.
 *   - Auto-enrich background agent (U9) filling missing imageUrl on
 *     existing blocks.
 *
 * Variant priority (matches existing apps/web preferredVideoImage
 * conventions):
 *   1. mobileCinematicHigh (best for hero / large cards)
 *   2. videoStill (good fallback)
 *   3. thumbnail
 *   4. url (legacy field)
 *
 * Returns null when the video has no images at all — the caller decides
 * whether to leave the block's imageUrl null or fall back to a default.
 */

import { createTool } from "@mastra/core/tools"
import { z } from "zod"

import { prisma } from "@/db/client"

const inputSchema = z.object({
  videoId: z
    .string()
    .min(1)
    .describe("The video's cuid id, as returned by searchVideos."),
})

const outputSchema = z.object({
  imageUrl: z.string().nullable(),
  variant: z.string().nullable(),
})

const VARIANT_PRIORITY = [
  "mobileCinematicHigh",
  "videoStill",
  "thumbnail",
  "url",
] as const

export const fetchVideoImageTool = createTool({
  id: "fetchVideoImage",
  description:
    "Get the best available image URL for a video by videoId. Returns the resolved URL and the variant name picked. Returns null when the video has no images.",
  inputSchema,
  outputSchema,
  execute: async (inputData, context) => {
    void context?.requestContext
    const images = await prisma.videoImage.findMany({
      where: {
        videoId: inputData.videoId,
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
  },
})
