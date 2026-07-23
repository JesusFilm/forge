import { NextResponse } from "next/server"

import { env, getGatewayBaseUrl } from "@/config/env"
import {
  GATEWAY_SESSION_COOKIE,
  readGatewaySessionCookie,
  type GatewaySession,
} from "@/lib/gateway-session"

const hopByHopHeaders = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
])

const bodyEncodingHeaders = new Set(["content-encoding", "content-length"])

export async function proxyMastraRequest(
  request: Request,
  upstreamPath: string,
  options: {
    authorizationKey?: string
    allowedRoles?: readonly string[]
    revalidateSession?: (
      session: GatewaySession,
    ) => Promise<GatewaySession | null>
  } = {},
) {
  let session = await readGatewaySessionCookie(
    getCookieValue(request.headers.get("cookie"), GATEWAY_SESSION_COOKIE),
  )

  if (!session) {
    const loginUrl = new URL("/api/auth/login", getGatewayBaseUrl())
    loginUrl.searchParams.set("returnTo", new URL(request.url).pathname)
    return NextResponse.redirect(loginUrl)
  }

  if (options.revalidateSession) {
    session = await options.revalidateSession(session)
    if (!session) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }
  }

  if (options.allowedRoles && !options.allowedRoles.includes(session.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const authorizationKey =
    options.authorizationKey ?? env.MASTRA_INTERNAL_API_KEY
  if (!env.MASTRA_INTERNAL_BASE_URL || !authorizationKey) {
    return NextResponse.json(
      { error: "Mastra gateway upstream is not configured." },
      { status: 503 },
    )
  }

  const requestUrl = new URL(request.url)
  const upstreamUrl = new URL(upstreamPath, env.MASTRA_INTERNAL_BASE_URL)
  upstreamUrl.search = requestUrl.search

  const headers = new Headers(request.headers)
  for (const header of hopByHopHeaders) headers.delete(header)
  headers.delete("accept-encoding")
  headers.delete("cookie")
  headers.delete("host")
  headers.set("accept-encoding", "identity")
  headers.set("authorization", `Bearer ${authorizationKey}`)
  headers.set("x-forge-user-subject", session.subject)
  if (session.email) headers.set("x-forge-user-email", session.email)
  headers.set("x-forge-studio-role", session.role)

  const response = await fetch(upstreamUrl, {
    method: request.method,
    headers,
    body: canForwardBody(request.method) ? request.body : undefined,
    duplex: canForwardBody(request.method) ? "half" : undefined,
    redirect: "manual",
  } as RequestInit)

  const responseHeaders = new Headers(response.headers)
  for (const header of hopByHopHeaders) responseHeaders.delete(header)
  for (const header of bodyEncodingHeaders) responseHeaders.delete(header)

  if (isHtmlResponse(responseHeaders)) {
    return new Response(
      rewriteMastraStudioHtml(await response.text(), getGatewayUrl(request)),
      {
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders,
      },
    )
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders,
  })
}

function canForwardBody(method: string) {
  return method !== "GET" && method !== "HEAD"
}

function getCookieValue(cookieHeader: string | null, name: string) {
  if (!cookieHeader) return undefined

  for (const part of cookieHeader.split(";")) {
    const [rawName, ...rawValue] = part.trim().split("=")
    if (rawName === name) return decodeURIComponent(rawValue.join("="))
  }

  return undefined
}

function isHtmlResponse(headers: Headers) {
  return headers.get("content-type")?.includes("text/html") ?? false
}

function getGatewayUrl(request: Request) {
  const requestUrl = new URL(request.url)
  const host =
    request.headers.get("x-forwarded-host") ?? request.headers.get("host")
  const protocol =
    request.headers.get("x-forwarded-proto") ?? requestUrl.protocol.slice(0, -1)

  if (!host) return requestUrl
  return new URL(`${protocol}://${host}`)
}

function rewriteMastraStudioHtml(html: string, gatewayUrl: URL) {
  const gatewayPort =
    gatewayUrl.port || (gatewayUrl.protocol === "https:" ? "443" : "80")

  return html
    .replace(
      /window\.MASTRA_SERVER_HOST = '[^']*';/,
      `window.MASTRA_SERVER_HOST = '${gatewayUrl.hostname}';`,
    )
    .replace(
      /window\.MASTRA_SERVER_PORT = '[^']*';/,
      `window.MASTRA_SERVER_PORT = '${gatewayPort}';`,
    )
    .replace(
      /window\.MASTRA_SERVER_PROTOCOL = '[^']*';/,
      `window.MASTRA_SERVER_PROTOCOL = '${gatewayUrl.protocol.replace(":", "")}';`,
    )
}
