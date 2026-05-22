import { NextResponse } from "next/server"

import { env, getGatewayBaseUrl } from "@/config/env"
import {
  GATEWAY_SESSION_COOKIE,
  readGatewaySessionCookie,
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
) {
  const session = await readGatewaySessionCookie(
    getCookieValue(request.headers.get("cookie"), GATEWAY_SESSION_COOKIE),
  )

  if (!session) {
    const loginUrl = new URL("/api/auth/login", getGatewayBaseUrl())
    loginUrl.searchParams.set("returnTo", new URL(request.url).pathname)
    return NextResponse.redirect(loginUrl)
  }

  if (!env.MASTRA_INTERNAL_BASE_URL || !env.MASTRA_INTERNAL_API_KEY) {
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
  headers.set("authorization", `Bearer ${env.MASTRA_INTERNAL_API_KEY}`)
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
