import { NextResponse } from "next/server"
import { z } from "zod"
import {
  SeoAssertionConfigurationError,
  SeoAssertionInvalidError,
} from "@/auth/seo-assertion-keyring"
import {
  SeoAssertionReplayError,
  SeoLedgerConflictError,
} from "@/services/seo-experiment.service"

export const SEO_ROUTE_BODY_LIMIT_BYTES = 1_000_000

export async function readBoundedSeoBody(request: Request): Promise<string> {
  const declared = Number(request.headers.get("content-length") ?? "0")
  if (Number.isFinite(declared) && declared > SEO_ROUTE_BODY_LIMIT_BYTES) {
    await request.body?.cancel().catch(() => {})
    throw new SeoRouteBodyError("request_too_large")
  }
  if (!request.body) return ""
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let received = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      received += value.byteLength
      if (received > SEO_ROUTE_BODY_LIMIT_BYTES) {
        await reader.cancel().catch(() => {})
        throw new SeoRouteBodyError("request_too_large")
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  return Buffer.concat(chunks).toString("utf8")
}

export function parseSeoJson(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    throw new SeoRouteBodyError("invalid_json")
  }
}

export function seoRouteError(error: unknown) {
  if (error instanceof SeoAssertionInvalidError) {
    return NextResponse.json(
      { ok: false, error: "invalid_assertion" },
      { status: 401 },
    )
  }
  if (error instanceof SeoAssertionConfigurationError) {
    return NextResponse.json(
      { ok: false, error: "assertion_unavailable" },
      { status: 503 },
    )
  }
  if (error instanceof SeoAssertionReplayError) {
    return NextResponse.json(
      { ok: false, error: "assertion_replayed" },
      { status: 409 },
    )
  }
  if (error instanceof SeoLedgerConflictError) {
    return NextResponse.json({ ok: false, error: error.code }, { status: 409 })
  }
  if (error instanceof SeoRouteBodyError || error instanceof z.ZodError) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof SeoRouteBodyError ? error.code : "invalid_request",
      },
      { status: 400 },
    )
  }
  console.error(
    `[seo] event=route_failed error=${error instanceof Error ? error.name : "UnknownError"}`,
  )
  return NextResponse.json(
    { ok: false, error: "internal_error" },
    { status: 500 },
  )
}

class SeoRouteBodyError extends Error {
  constructor(readonly code: "invalid_json" | "request_too_large") {
    super("Invalid SEO route body")
    this.name = "SeoRouteBodyError"
  }
}
