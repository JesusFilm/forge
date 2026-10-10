/**
 * POST /api/internal/agent-tools/lookup-bible-verse (consolidation U7).
 *
 * Bearer-gated BibleBook lookup for the standalone Mastra chat agent's
 * lookupBibleVerse tool. OR-match + locale-fallback displayName + take cap are
 * enforced server-side in `lookupBibleVerseForAgent`.
 */

import { prisma } from "@/db/client"
import {
  lookupBibleVerseForAgent,
  lookupBibleVerseRequestSchema,
} from "@/services/experience-ai/agent-tools.service"

import { agentToolRoute, badRequest, unauthorized } from "../route-utils"

export const POST = agentToolRoute(
  "agent-tools-lookup-bible-verse",
  async (body) => {
    const parsed = lookupBibleVerseRequestSchema.safeParse(body)
    if (!parsed.success) {
      return badRequest("Invalid lookup-bible-verse request body")
    }
    const result = await lookupBibleVerseForAgent(prisma, parsed.data)
    return Response.json(result, { status: 200 })
  },
)

export async function GET(): Promise<Response> {
  return unauthorized()
}
