// POST /api/admin-embeds/scene — proxy to admin's
// `triggerSceneEmbeddingBackfill` GraphQL mutation. Manager owns the
// presentation surface; admin owns execution. See plan 006.
//
// Response envelope:
//   200 { result: <admin mutation response> }                    — success
//   400 { error: "Invalid JSON body" | "Validation failed", ... } — manager-side input
//   401/403 (from authenticateRequest)                            — auth gate failure
//   502 { error, reason, messages, retryable }                    — admin-side failure
//   503 { error, reason, messages, retryable }                    — manager misconfigured
//
// `reason` ∈ "graphql_error" | "network_error" | "parse_error" | "config_missing".
// `retryable` is true for transient transport errors, false for upstream rejections
// or operator misconfig.

import { z } from "zod"
import { triggerSceneEmbeddingBackfill } from "@/lib/admin-embed-trigger"
import { proxyAdminEmbedTrigger } from "@/lib/admin-embed-route"

const bodySchema = z.object({
  mappingS3Key: z.string().min(1).optional(),
  coreIds: z.array(z.string().min(1)).optional(),
  locales: z.array(z.string().min(1)).optional(),
})

export async function POST(request: Request) {
  return proxyAdminEmbedTrigger({
    request,
    bodySchema,
    trigger: triggerSceneEmbeddingBackfill,
  })
}
