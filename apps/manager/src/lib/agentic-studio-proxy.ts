import { NextResponse } from "next/server"
import { env } from "@/config/env"
import { verifyManagerSession } from "@/lib/auth"

type AgenticStudioRouteParams = {
  path?: string[]
}

type AgenticStudioAuthResult = { ok: true } | { ok: false; response: Response }

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"])
const SAFE_REQUEST_HEADERS = new Set([
  "accept",
  "accept-language",
  "cache-control",
  "content-type",
  "pragma",
  "range",
])
const SAFE_RESPONSE_HEADERS = new Set([
  "accept-ranges",
  "cache-control",
  "content-language",
  "content-range",
  "content-type",
  "etag",
  "last-modified",
])

function forbiddenResponseReferences(): string[] {
  return [
    env.AGENTIC_STUDIO_ORIGIN,
    env.AGENTIC_BASE_URL,
    "https://forgeagentic-stage.up.railway.app",
    "http://forgeagentic-stage.up.railway.app",
  ].filter((value): value is string => Boolean(value))
}

function forbiddenInternalPattern(text: string): boolean {
  return (
    /\.railway\.internal(?::\d+)?/.test(text) ||
    /https?:\/\/forgeagentic-stage\.up\.railway\.app/.test(text)
  )
}

function forbiddenSecretPattern(text: string): boolean {
  return [
    env.AGENTIC_OPERATOR_API_KEY,
    env.MANAGER_API_KEY,
    env.AGENTIC_SERVICE_API_KEY,
    env.MANAGER_AGENTIC_API_KEY,
    env.STRAPI_API_TOKEN,
    env.STRAPI_INTERNAL_API_TOKEN,
  ].some((secret) => secret && text.includes(secret))
}

function json(status: number, body: Record<string, unknown>): Response {
  return NextResponse.json(body, { status })
}

function getCookieValue(request: Request, name: string): string | null {
  const cookieHeader = request.headers.get("cookie") ?? ""
  const encodedName = `${name}=`
  const cookie = cookieHeader
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(encodedName))

  if (!cookie) {
    return null
  }

  try {
    return decodeURIComponent(cookie.slice(encodedName.length))
  } catch {
    return null
  }
}

function getManagerOrigin(request: Request): string {
  return new URL(request.url).origin
}

function isTrustedBrowserOrigin(request: Request): boolean {
  const managerOrigin = getManagerOrigin(request)
  const origin = request.headers.get("origin")

  if (origin) {
    return origin === managerOrigin
  }

  const referer = request.headers.get("referer")
  if (!referer) {
    return false
  }

  try {
    return new URL(referer).origin === managerOrigin
  } catch {
    return false
  }
}

function buildUpstreamUrl(
  request: Request,
  origin: string,
  params: AgenticStudioRouteParams,
): string {
  const upstream = new URL(origin)
  const path = params.path ?? []
  const encodedPath = path
    .map((segment) => encodeURIComponent(segment))
    .join("/")
  const basePath = upstream.pathname.replace(/\/$/, "")
  upstream.pathname = `${basePath}/${encodedPath}`.replace(/\/+$/, "") || "/"
  upstream.search = new URL(request.url).search
  return upstream.toString()
}

function buildUpstreamHeaders(
  request: Request,
  operatorApiKey: string,
): Headers {
  const headers = new Headers()

  for (const [name, value] of request.headers.entries()) {
    const lowerName = name.toLowerCase()
    if (SAFE_REQUEST_HEADERS.has(lowerName)) {
      headers.set(lowerName, value)
    }
  }

  headers.set("authorization", `Bearer ${operatorApiKey}`)
  return headers
}

function sanitizeResponseHeaders(upstreamHeaders: Headers): Headers {
  const headers = new Headers()

  for (const [name, value] of upstreamHeaders.entries()) {
    const lowerName = name.toLowerCase()
    if (SAFE_RESPONSE_HEADERS.has(lowerName)) {
      headers.set(lowerName, value)
    }
  }

  headers.set("cache-control", "private, no-store")
  headers.set("vary", "Cookie")

  return headers
}

function shouldRewriteBody(headers: Headers): boolean {
  const contentType = headers.get("content-type")?.toLowerCase() ?? ""
  return (
    contentType.includes("text/html") ||
    contentType.includes("application/json") ||
    contentType.includes("application/javascript") ||
    contentType.includes("text/javascript")
  )
}

function rewriteStudioBody(body: string): string {
  let rewritten = body

  for (const reference of forbiddenResponseReferences()) {
    rewritten = rewritten.split(reference).join("/api/agentic-studio")
  }

  return rewritten
    .replace(/(["'`])\/(api|assets)\//g, "$1/api/agentic-studio/$2/")
    .replace(
      /\b(href|src|action)=("|')\/(?!api\/agentic-studio\/)([^"'#?:][^"']*)/g,
      "$1=$2/api/agentic-studio/$3",
    )
    .replace(
      /\burl\(["']?\/(?!api\/agentic-studio\/)([^"')]+)["']?\)/g,
      (_match, assetPath: string) => `url("/api/agentic-studio/${assetPath}")`,
    )
}

function rewriteSafeRedirectLocation(
  location: string,
  upstreamUrl: string,
  studioOrigin: string,
): string | null {
  const resolvedLocation = new URL(location, upstreamUrl)
  if (resolvedLocation.origin !== new URL(studioOrigin).origin) {
    return null
  }

  return `/api/agentic-studio${resolvedLocation.pathname}${resolvedLocation.search}${resolvedLocation.hash}`
}

async function buildSafeResponse(
  upstreamResponse: Response,
): Promise<Response> {
  const headers = sanitizeResponseHeaders(upstreamResponse.headers)

  if (shouldRewriteBody(upstreamResponse.headers)) {
    const rewritten = rewriteStudioBody(await upstreamResponse.text())
    if (forbiddenInternalPattern(rewritten)) {
      return json(503, {
        error: "Agentic Studio response is not safe to expose",
      })
    }
    if (forbiddenSecretPattern(rewritten)) {
      return json(503, {
        error: "Agentic Studio response included a server secret",
      })
    }

    if (headers.get("content-type")?.includes("text/html")) {
      headers.set(
        "content-security-policy",
        [
          "default-src 'self'",
          "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
          "style-src 'self' 'unsafe-inline'",
          "img-src 'self' data: blob:",
          "connect-src 'self'",
          "font-src 'self' data:",
          "frame-ancestors 'self'",
          "base-uri 'self'",
          "form-action 'self'",
        ].join("; "),
      )
    }

    return new Response(rewritten, {
      status: upstreamResponse.status,
      statusText: upstreamResponse.statusText,
      headers,
    })
  }

  return new Response(upstreamResponse.body, {
    status: upstreamResponse.status,
    statusText: upstreamResponse.statusText,
    headers,
  })
}

export async function authorizeAgenticStudioSession(
  request: Request,
): Promise<AgenticStudioAuthResult> {
  const jwt = getCookieValue(request, "strapi-jwt")
  if (!jwt) {
    return {
      ok: false,
      response: json(403, { error: "Manager session required" }),
    }
  }

  const user = await verifyManagerSession(jwt)
  if (user?.role?.name !== "Manager") {
    return {
      ok: false,
      response: json(403, { error: "Manager session required" }),
    }
  }

  return { ok: true }
}

export async function proxyAgenticStudioRequest(
  request: Request,
  params: AgenticStudioRouteParams,
): Promise<Response> {
  const auth = await authorizeAgenticStudioSession(request)
  if (!auth.ok) {
    return auth.response
  }

  if (!env.AGENTIC_STUDIO_ORIGIN || !env.AGENTIC_OPERATOR_API_KEY) {
    return json(503, { error: "Agentic Studio proxy is not configured" })
  }

  if (
    MUTATING_METHODS.has(request.method.toUpperCase()) &&
    !isTrustedBrowserOrigin(request)
  ) {
    return json(403, { error: "Same-origin request required" })
  }

  try {
    const upstreamUrl = buildUpstreamUrl(
      request,
      env.AGENTIC_STUDIO_ORIGIN,
      params,
    )
    const upstreamResponse = await fetch(upstreamUrl, {
      method: request.method,
      headers: buildUpstreamHeaders(request, env.AGENTIC_OPERATOR_API_KEY),
      body:
        request.method === "GET" || request.method === "HEAD"
          ? undefined
          : request.body,
      redirect: "manual",
      signal: AbortSignal.timeout(env.AGENTIC_REQUEST_TIMEOUT_MS ?? 15000),
      // Required by undici when forwarding a streamed Request body.
      duplex: "half",
    } as RequestInit & { duplex: "half" })

    const location = upstreamResponse.headers.get("location")
    if (location) {
      const rewrittenLocation = rewriteSafeRedirectLocation(
        location,
        upstreamUrl,
        env.AGENTIC_STUDIO_ORIGIN,
      )
      if (!rewrittenLocation) {
        return json(503, {
          error: "Agentic Studio redirect is not safe to expose",
        })
      }

      const response = await buildSafeResponse(upstreamResponse)
      response.headers.set("location", rewrittenLocation)
      return response
    }

    return await buildSafeResponse(upstreamResponse)
  } catch {
    return json(503, { error: "Agentic Studio proxy request failed" })
  }
}
