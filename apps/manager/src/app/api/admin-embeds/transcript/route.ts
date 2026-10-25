// POST /api/admin-embeds/transcript — proxy to admin's
// `triggerTranscriptEmbeddingBackfill` GraphQL mutation. Manager owns
// the presentation surface; admin owns execution. See plan 006.
//
// Response envelope is produced by `proxyAdminEmbedTrigger`.

import { z } from "zod"
import { triggerTranscriptEmbeddingBackfill } from "@/lib/admin-embed-trigger"
import { proxyAdminEmbedTrigger } from "@/lib/admin-embed-route"

const bodySchema = z.object({
  mappingS3Key: z.string().min(1).optional(),
  coreIds: z.array(z.string().min(1)).optional(),
  languages: z.array(z.string().min(1)).optional(),
})

export async function POST(request: Request) {
  return proxyAdminEmbedTrigger({
    request,
    bodySchema,
    trigger: triggerTranscriptEmbeddingBackfill,
  })
}
