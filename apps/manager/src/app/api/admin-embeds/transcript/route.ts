// POST /api/admin-embeds/transcript — proxy to admin's
// `triggerTranscriptEmbeddingBackfill` GraphQL mutation. Manager owns
// the presentation surface; admin owns execution. See plan 006.

import { NextResponse } from "next/server"
import { z } from "zod"
import { authenticateRequest } from "@/lib/auth"
import { triggerTranscriptEmbeddingBackfill } from "@/lib/admin-embed-trigger"

const bodySchema = z.object({
  mappingS3Key: z.string().min(1).optional(),
  coreIds: z.array(z.string().min(1)).optional(),
  languages: z.array(z.string().min(1)).optional(),
})

export async function POST(request: Request) {
  const authError = await authenticateRequest(request)
  if (authError) return authError

  let rawBody: unknown
  try {
    rawBody = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const parsed = bodySchema.safeParse(rawBody)
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 400 },
    )
  }

  const result = await triggerTranscriptEmbeddingBackfill(parsed.data)

  if (result.ok) {
    return NextResponse.json({ result: result.data }, { status: 200 })
  }

  if (result.reason === "config_missing") {
    return NextResponse.json({ error: result.message }, { status: 500 })
  }

  const messages =
    result.reason === "graphql_error" ? result.messages : [result.message]
  return NextResponse.json(
    { error: "admin trigger failed", reason: result.reason, messages },
    { status: 502 },
  )
}
