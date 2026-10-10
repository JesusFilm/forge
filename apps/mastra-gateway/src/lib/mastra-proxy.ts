import { randomUUID } from "node:crypto"

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

const DEFAULT_WORKSPACE_MAX_REQUEST_BYTES = 12 * 1024 * 1024
const DEFAULT_WORKSPACE_TIMEOUT_MS = 30_000
const DEFAULT_WORKSPACE_MAX_CONCURRENCY = 4
const DEFAULT_WORKSPACE_REQUESTS_PER_MINUTE = 120

const workspaceConcurrency = new Map<string, number>()
const workspaceRate = new Map<string, { startedAt: number; count: number }>()

class RequestBodyLimitError extends Error {}

export async function proxyMastraRequest(
  request: Request,
  upstreamPath: string,
  options: {
    authorizationKey?: string
    allowedRoles?: readonly string[]
    revalidateSession?: (
      session: GatewaySession,
    ) => Promise<GatewaySession | null>
    workspaceRequest?: boolean
    maxRequestBytes?: number
    timeoutMs?: number
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

  let workspaceSlotHeld = false
  if (options.workspaceRequest) {
    const rate = workspaceRate.get(session.subject)
    const now = Date.now()
    if (!rate || now - rate.startedAt >= 60_000) {
      workspaceRate.set(session.subject, { startedAt: now, count: 1 })
    } else {
      rate.count += 1
      if (rate.count > DEFAULT_WORKSPACE_REQUESTS_PER_MINUTE) {
        return NextResponse.json(
          { error: "Workspace request rate exceeded." },
          { status: 429 },
        )
      }
    }

    const concurrency = workspaceConcurrency.get(session.subject) ?? 0
    if (concurrency >= DEFAULT_WORKSPACE_MAX_CONCURRENCY) {
      return NextResponse.json(
        { error: "Too many concurrent Workspace requests." },
        { status: 429 },
      )
    }
    workspaceConcurrency.set(session.subject, concurrency + 1)
    workspaceSlotHeld = true
  }

  try {
    const response = await proxyAuthorizedMastraRequest(
      request,
      upstreamPath,
      session,
      {
        ...options,
        authorizationKey:
          options.authorizationKey ?? env.MASTRA_INTERNAL_API_KEY,
      },
    )
    if (!workspaceSlotHeld) return response
    workspaceSlotHeld = false
    return retainWorkspaceConcurrency(response, session.subject)
  } catch (error) {
    if (workspaceSlotHeld) {
      releaseWorkspaceConcurrency(session.subject)
    }
    throw error
  }
}

async function proxyAuthorizedMastraRequest(
  request: Request,
  upstreamPath: string,
  session: GatewaySession,
  options: {
    authorizationKey?: string
    workspaceRequest?: boolean
    maxRequestBytes?: number
    timeoutMs?: number
  },
) {
  const maxRequestBytes =
    options.maxRequestBytes ?? DEFAULT_WORKSPACE_MAX_REQUEST_BYTES
  if (options.workspaceRequest) {
    const declaredLength = request.headers.get("content-length")
    if (
      declaredLength &&
      (!/^\d+$/u.test(declaredLength) ||
        Number(declaredLength) > maxRequestBytes)
    ) {
      return NextResponse.json(
        { error: "Workspace request body is too large." },
        { status: 413 },
      )
    }
    if (
      canForwardBody(request.method) &&
      request.body !== null &&
      !request.headers.get("content-type")?.includes("application/json")
    ) {
      return NextResponse.json(
        { error: "Workspace mutations require application/json." },
        { status: 415 },
      )
    }
  }

  const authorizationKey = options.authorizationKey
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
  const requestId = randomUUID()
  headers.set("x-forge-request-id", requestId)
  if (options.workspaceRequest) {
    headers.set("x-forge-workspace-actor-id", session.subject)
    headers.set("x-forge-workspace-request-id", requestId)
    if (canForwardBody(request.method) || request.method === "DELETE") {
      headers.set("x-forge-workspace-editorial-rights-assertion", "true")
    }
  }
  headers.set("x-forge-user-subject", session.subject)
  if (session.email) headers.set("x-forge-user-email", session.email)
  headers.set("x-forge-studio-role", session.role)

  const canHaveBody = canForwardBody(request.method)
  const body =
    canHaveBody && options.workspaceRequest && request.body
      ? request.body.pipeThrough(createRequestLimitStream(maxRequestBytes))
      : canHaveBody
        ? request.body
        : undefined

  let response: Response
  try {
    response = await fetch(upstreamUrl, {
      method: request.method,
      headers,
      body,
      duplex: canHaveBody ? "half" : undefined,
      redirect: "manual",
      signal: AbortSignal.any([
        request.signal,
        AbortSignal.timeout(options.timeoutMs ?? DEFAULT_WORKSPACE_TIMEOUT_MS),
      ]),
    } as RequestInit)
  } catch (error) {
    if (error instanceof RequestBodyLimitError) {
      return NextResponse.json(
        { error: "Workspace request body is too large." },
        { status: 413 },
      )
    }
    if (error instanceof DOMException && error.name === "TimeoutError") {
      return NextResponse.json(
        { error: "Mastra Workspace request timed out." },
        { status: 504 },
      )
    }
    throw error
  }

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

function releaseWorkspaceConcurrency(subject: string): void {
  const concurrency = workspaceConcurrency.get(subject) ?? 1
  if (concurrency <= 1) workspaceConcurrency.delete(subject)
  else workspaceConcurrency.set(subject, concurrency - 1)
}

function retainWorkspaceConcurrency(
  response: Response,
  subject: string,
): Response {
  if (!response.body) {
    releaseWorkspaceConcurrency(subject)
    return response
  }
  const reader = response.body.getReader()
  let released = false
  const release = () => {
    if (released) return
    released = true
    releaseWorkspaceConcurrency(subject)
  }
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const result = await reader.read()
        if (result.done) {
          release()
          controller.close()
          return
        }
        controller.enqueue(result.value)
      } catch (error) {
        release()
        controller.error(error)
      }
    },
    async cancel(reason) {
      try {
        await reader.cancel(reason)
      } finally {
        release()
      }
    },
  })
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  })
}

function createRequestLimitStream(maxBytes: number) {
  let bytes = 0
  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      bytes += chunk.byteLength
      if (bytes > maxBytes) {
        controller.error(new RequestBodyLimitError())
        return
      }
      controller.enqueue(chunk)
    },
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
