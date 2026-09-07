import { NextResponse } from "next/server"
import { authenticateInteractiveManagerRequest } from "./auth"
import { env } from "@/config/env"

/** Same-origin only for cookie-authenticated writes; a bearer is never interactive. */
export async function authenticateStudioRequest(request: Request) {
  const origin = request.headers.get("origin")
  const expected = new URL(env.MANAGER_BASE_URL ?? request.url).origin
  if (origin !== expected)
    return NextResponse.json(
      { error: "Same-origin interactive request required" },
      { status: 403 },
    )
  return authenticateInteractiveManagerRequest(request)
}

export class StudioRequestTooLarge extends Error {}
/** Cap bytes while streaming, including requests without Content-Length. */
export async function readStudioBody(request: Request, limit: number) {
  if (Number(request.headers.get("content-length")) > limit)
    throw new StudioRequestTooLarge()
  const reader = request.body?.getReader()
  if (!reader) return new Uint8Array()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.length
      if (size > limit) throw new StudioRequestTooLarge()
      chunks.push(value)
    }
    return new Uint8Array(Buffer.concat(chunks))
  } catch (error) {
    await reader.cancel().catch(() => {})
    throw error
  } finally {
    reader.releaseLock()
  }
}
