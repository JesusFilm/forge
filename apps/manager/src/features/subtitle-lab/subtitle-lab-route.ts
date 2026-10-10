import { NextResponse } from "next/server"

import { env } from "@/config/env"
import {
  authenticateInteractiveManagerRequest,
  authenticateInteractiveReviewerRequest,
} from "@/lib/auth"
import {
  MANAGER_SESSION_COOKIE,
  readManagerSessionCookie,
  type ManagerSessionPrincipal,
} from "@/lib/manager-session-cookie"

export async function requireSubtitleLabOperator(request: Request) {
  const actor = await authenticateInteractiveManagerRequest(request)
  if (actor instanceof NextResponse) return actor
  const raw = await readSession(request)
  if (!raw || raw.managerRole !== "OPERATOR") {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }
  return { ...raw, id: actor.approvedByUserId } as ManagerSessionPrincipal
}

export async function requireSubtitleLabReviewer(request: Request) {
  const actor = await authenticateInteractiveReviewerRequest(request)
  return actor instanceof NextResponse ? subtitleLabNotFound() : actor.session
}

export function guardSubtitleLabMutation(request: Request) {
  if (
    request.headers.get("content-type")?.split(";", 1)[0]?.trim() !==
    "application/json"
  ) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }
  const expectedOrigin = env.MANAGER_BASE_URL
    ? new URL(env.MANAGER_BASE_URL).origin
    : env.NODE_ENV === "production"
      ? null
      : new URL(request.url).origin
  if (!expectedOrigin || request.headers.get("origin") !== expectedOrigin) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }
  return null
}

export async function readBoundedSubtitleLabJson(
  request: Request,
  maximumBytes = 512 * 1024,
) {
  const declared = Number(request.headers.get("content-length"))
  if (Number.isFinite(declared) && declared > maximumBytes) {
    await request.body?.cancel().catch(() => undefined)
    throw new Error("Request too large")
  }
  if (!request.body) throw new Error("Request body missing")
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > maximumBytes) {
      await reader.cancel().catch(() => undefined)
      throw new Error("Request too large")
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return JSON.parse(new TextDecoder().decode(bytes)) as unknown
}

export function privateNoStoreJson(value: unknown, init?: ResponseInit) {
  const headers = new Headers(init?.headers)
  headers.set("cache-control", "private, no-store")
  headers.set("pragma", "no-cache")
  headers.set("vary", "Cookie")
  headers.set("x-content-type-options", "nosniff")
  return NextResponse.json(value, { ...init, headers })
}

export function subtitleLabNotFound() {
  return privateNoStoreJson({ error: "Not found" }, { status: 404 })
}

export function subtitleLabUpstreamUnavailable() {
  return privateNoStoreJson(
    { error: "Temporarily unavailable", retryable: true },
    { status: 503 },
  )
}

async function readSession(request: Request) {
  const value = request.headers
    .get("cookie")
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${MANAGER_SESSION_COOKIE}=`))
    ?.slice(MANAGER_SESSION_COOKIE.length + 1)
  return readManagerSessionCookie(value)
}
