import { timingSafeEqual } from "node:crypto"
import { env } from "@/config/env"
import { dispatchCoreSync } from "@/services/core-sync/job"

type ScheduledSyncBody = {
  incremental?: unknown
  scope?: unknown
}

function reject(): Response {
  return Response.json({ error: "Unauthorized" }, { status: 401 })
}

function badRequest(message: string): Response {
  return Response.json({ error: message }, { status: 400 })
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

async function readBody(request: Request): Promise<ScheduledSyncBody> {
  if (!request.headers.get("content-type")?.includes("application/json")) {
    return {}
  }

  return (await request.json()) as ScheduledSyncBody
}

function readIncremental(value: unknown): boolean {
  if (value == null) return true
  if (typeof value === "boolean") return value
  throw new Error("incremental must be a boolean")
}

function readScope(value: unknown): string[] | undefined {
  if (value == null) return undefined
  if (typeof value === "string") {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
  }
  if (Array.isArray(value) && value.every((item) => typeof item === "string")) {
    return value.map((item) => item.trim()).filter(Boolean)
  }
  throw new Error("scope must be a string or string array")
}

export async function POST(request: Request): Promise<Response> {
  if (!isAuthorized(request)) return reject()

  let body: ScheduledSyncBody
  try {
    body = await readBody(request)
  } catch {
    return badRequest("Invalid JSON body")
  }

  let incremental: boolean
  let scope: string[] | undefined
  try {
    incremental = readIncremental(body.incremental)
    scope = readScope(body.scope)
  } catch (error) {
    return badRequest(error instanceof Error ? error.message : "Invalid body")
  }

  const dispatch = await dispatchCoreSync({
    incremental,
    scope,
    trigger: "scheduled",
  })

  return Response.json({ ok: true, dispatch }, { status: 202 })
}

export async function GET(): Promise<Response> {
  return methodNotAllowed()
}
