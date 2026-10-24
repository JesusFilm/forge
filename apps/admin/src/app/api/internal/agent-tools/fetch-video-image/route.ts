/**
 * POST /api/internal/agent-tools/fetch-video-image (consolidation U7).
 *
 * Bearer-gated best-image lookup for the standalone Mastra chat agent's
 * fetchVideoImage tool. The VARIANT_PRIORITY pick is enforced server-side in
 * `fetchVideoImageForAgent`.
 */

import { prisma } from "@/db/client"
import {
  fetchVideoImageForAgent,
  fetchVideoImageRequestSchema,
} from "@/services/experience-ai/agent-tools.service"

import { agentToolRoute, badRequest, unauthorized } from "../route-utils"

export const POST = agentToolRoute(
  "agent-tools-fetch-video-image",
  async (body) => {
    const parsed = fetchVideoImageRequestSchema.safeParse(body)
    if (!parsed.success) {
      return badRequest("Invalid fetch-video-image request body")
    }
    const result = await fetchVideoImageForAgent(prisma, parsed.data)
    return Response.json(result, { status: 200 })
  },
)

export async function GET(): Promise<Response> {
  return unauthorized()
}
