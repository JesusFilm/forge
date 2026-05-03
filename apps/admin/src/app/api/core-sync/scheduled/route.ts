import { timingSafeEqual } from "node:crypto"
import { env } from "@/config/env"
import { dispatchCoreSync } from "@/services/core-sync/job"

function reject(): Response {
  return Response.json({ error: "Unauthorized" }, { status: 401 })
}

function methodNotAllowed(): Response {
  return Response.json(
    { error: "Method Not Allowed" },
    { status: 405, headers: { Allow: "POST" } },
  )
}

function getBearerToken(request: Request): string | null {
  const header = request.headers.get("authorization")
  if (!header) return null

  const [scheme, token] = header.split(" ")
  if (scheme?.toLowerCase() !== "bearer" || !token) return null
  return token
}

function tokenMatches(token: string, secret: string): boolean {
  const tokenBuffer = Buffer.from(token)
  const secretBuffer = Buffer.from(secret)
  return (
    tokenBuffer.length === secretBuffer.length &&
    timingSafeEqual(tokenBuffer, secretBuffer)
  )
}

function isAuthorized(request: Request): boolean {
  if (!env.CORE_SYNC_CRON_SECRET) return false

  const token = getBearerToken(request)
  return token ? tokenMatches(token, env.CORE_SYNC_CRON_SECRET) : false
}

export async function POST(request: Request): Promise<Response> {
  if (!isAuthorized(request)) return reject()

  const dispatch = await dispatchCoreSync({
    incremental: true,
    trigger: "scheduled",
  })

  return Response.json({ ok: true, dispatch }, { status: 202 })
}

export async function GET(): Promise<Response> {
  return methodNotAllowed()
}
