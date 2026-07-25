/**
 * POST /api/internal/agent-tools/search-videos (consolidation U7).
 *
 * Bearer-gated catalog search for the standalone Mastra chat agent's
 * searchVideos tool. All load-bearing filters/caps are enforced server-side in
 * `searchVideosForAgent` (contentTypes:["video"] + playbackId!==null + limit
 * cap) — the mastra caller is untrusted.
 */

import { prisma } from "@/db/client"
import {
  searchVideosForAgent,
  searchVideosRequestSchema,
} from "@/services/experience-ai/agent-tools.service"

import { agentToolRoute, badRequest, unauthorized } from "../route-utils"

export const POST = agentToolRoute(
  "agent-tools-search-videos",
  async (body) => {
    const parsed = searchVideosRequestSchema.safeParse(body)
    if (!parsed.success) {
      return badRequest("Invalid search-videos request body")
    }
    const result = await searchVideosForAgent(prisma, parsed.data)
    return Response.json(result, { status: 200 })
  },
)

export async function GET(): Promise<Response> {
  return unauthorized()
}
