import { NextResponse } from "next/server"

import { env } from "@/config/env"
import {
  assertBearerCsvsDisjoint,
  validateEnrichmentCallbackBearer,
} from "@/lib/admin-trigger-auth"
import {
  applyEnrichmentCallback,
  EnrichmentCallbackSchema,
} from "@/lib/enrichment-callback"

const CALLBACK_BODY_MAX_BYTES = 64 * 1024

type JsonBodyResult =
  | { ok: true; body: unknown }
  | { ok: false; status: 400 | 413; error: string }

async function readJsonBodyWithLimit(
  request: Request,
): Promise<JsonBodyResult> {
  const contentLength = request.headers.get("content-length")
  if (contentLength && Number(contentLength) > CALLBACK_BODY_MAX_BYTES) {
    return {
      ok: false,
      status: 413,
      error: "Callback body is too large",
    }
  }

  const reader = request.body?.getReader()
  if (!reader) {
    return { ok: false, status: 400, error: "Invalid JSON body" }
  }

  const chunks: Uint8Array[] = []
  let received = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    if (!value) continue

    received += value.byteLength
    if (received > CALLBACK_BODY_MAX_BYTES) {
      await reader.cancel().catch(() => {})
      return {
        ok: false,
        status: 413,
        error: "Callback body is too large",
      }
    }
    chunks.push(value)
  }

  const body = new Uint8Array(received)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }

  try {
    return {
      ok: true,
      body: JSON.parse(new TextDecoder().decode(body)) as unknown,
    }
  } catch {
    return { ok: false, status: 400, error: "Invalid JSON body" }
  }
}

export async function POST(request: Request) {
  const auth = validateEnrichmentCallbackBearer(request)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status })
  }

  if (
    !assertBearerCsvsDisjoint(
      env.ADMIN_TRIGGER_API_KEYS,
      env.ENRICHMENT_CALLBACK_API_KEYS,
    )
  ) {
    return NextResponse.json(
      {
        error:
          "config_invalid: ADMIN_TRIGGER_API_KEYS and ENRICHMENT_CALLBACK_API_KEYS must be disjoint",
      },
      { status: 503 },
    )
  }

  const rawBody = await readJsonBodyWithLimit(request)
  if (!rawBody.ok) {
    return NextResponse.json(
      { error: rawBody.error },
      { status: rawBody.status },
    )
  }

  const parsed = EnrichmentCallbackSchema.safeParse(rawBody.body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 400 },
    )
  }

  const result = await applyEnrichmentCallback(parsed.data)
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }

  return NextResponse.json(result)
}
