import { z } from "zod"
import {
  AdminMcpAuthError,
  resolveAdminMcpPrincipal,
} from "@/auth/admin-mcp-oauth"
import { rateLimitAuthRoute } from "@/auth/rate-limit"
import type { Principal } from "@/auth/principal"
import { prisma } from "@/db/client"
import { getAdminMcpResourceUrl } from "@/mcp/admin-mcp-metadata"
import { ADMIN_MCP_TOOLS, findAdminMcpTool } from "@/mcp/admin-mcp-tools"
import { ExperienceLocaleMcpService } from "@/services/experience-locale-mcp.service"
import { ForbiddenError, NotFoundError } from "@/services/errors"

const RATE_LIMIT_MAX = 120
const RATE_LIMIT_WINDOW_MS = 60_000
const MAX_BODY_BYTES = 64 * 1024
const JSONRPC_VERSION = "2.0"
const MCP_PROTOCOL_VERSION = "2025-11-25"

type JsonRpcRequest = {
  jsonrpc?: unknown
  id?: unknown
  method?: unknown
  params?: unknown
}

export async function GET(request: Request) {
  void request
  return Response.json(
    { error: "Method not allowed" },
    { status: 405, headers: { allow: "POST" } },
  )
}

export async function POST(request: Request): Promise<Response> {
  const limit = await rateLimitAuthRoute({
    request,
    route: "admin-mcp",
    limit: RATE_LIMIT_MAX,
    windowMs: RATE_LIMIT_WINDOW_MS,
  })
  if (!limit.allowed) {
    return Response.json(
      { error: "Too many requests" },
      { status: 429, headers: { "retry-after": "60" } },
    )
  }

  const body = await readJsonBody(request)
  if (body instanceof Response) return body

  const requestBody = normalizeJsonRpcRequest(body)
  const requiredScopes = requiredScopesForRequest(requestBody)
  let principal: Principal
  try {
    const verified = await resolveAdminMcpPrincipal({
      authHeader: request.headers.get("authorization"),
      requiredScopes,
    })
    principal = verified.principal
  } catch (error) {
    return authErrorResponse(error, requiredScopes)
  }

  return Response.json(await handleJsonRpc(requestBody, principal))
}

async function handleJsonRpc(request: JsonRpcRequest, user: Principal) {
  const id = request.id ?? null
  if (
    request.jsonrpc !== JSONRPC_VERSION ||
    typeof request.method !== "string"
  ) {
    return jsonRpcError(id, -32600, "Invalid JSON-RPC request.")
  }

  if (request.method === "initialize") {
    return {
      jsonrpc: JSONRPC_VERSION,
      id,
      result: {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {
          tools: {
            listChanged: false,
          },
        },
        serverInfo: {
          name: "jfp-admin-mcp",
          title: "Jesus Film Admin MCP",
          version: "0.1.0",
        },
      },
    }
  }

  if (request.method === "tools/list") {
    return {
      jsonrpc: JSONRPC_VERSION,
      id,
      result: {
        tools: ADMIN_MCP_TOOLS.map((tool) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
        })),
      },
    }
  }

  if (request.method === "tools/call") {
    const toolName = getToolName(request.params)
    const tool = toolName ? findAdminMcpTool(toolName) : undefined
    if (!tool) return jsonRpcError(id, -32602, "Unknown Admin MCP tool.")
    try {
      const service = new ExperienceLocaleMcpService(prisma)
      const result = await callAdminMcpTool(service, tool.name, {
        input: getToolArguments(request.params),
        user,
      })
      return jsonRpcResult(id, {
        structuredContent: result,
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      })
    } catch (error) {
      return toolError(id, error)
    }
  }

  return jsonRpcError(id, -32601, "JSON-RPC method is not implemented.")
}

async function callAdminMcpTool(
  service: ExperienceLocaleMcpService,
  name: string,
  args: { input: unknown; user: Principal },
) {
  if (name === "experience.list") return service.listExperiences(args)
  if (name === "experience.locale.list") return service.listLocales(args)
  if (name === "experience.locale.read") return service.readLocale(args)
  if (name === "experience.locale.missing") {
    return service.findMissingLocales(args)
  }
  if (name === "experience.locale.validate") {
    return service.validateLocaleDraft({ input: args.input })
  }
  if (name === "experience.locale.diff") {
    return service.diffLocaleDraft(args)
  }
  if (name === "experience.locale.create") return service.createLocale(args)
  if (name === "experience.locale.update") return service.updateLocale(args)
  if (name === "experience.locale.publish") return service.publishLocale(args)
  if (name === "experience.media.check") return service.checkMedia(args)
  if (name === "video.search_replacements") {
    return service.searchReplacementVideos(args)
  }
  if (name === "bible.lookup") return service.lookupBible(args)
  throw new Error("not_implemented")
}

function requiredScopesForRequest(request: JsonRpcRequest): readonly string[] {
  if (request.method !== "tools/call") return []
  const toolName = getToolName(request.params)
  return toolName ? (findAdminMcpTool(toolName)?.requiredScopes ?? []) : []
}

function getToolName(params: unknown) {
  if (!params || typeof params !== "object" || !("name" in params)) return null
  const name = (params as { name?: unknown }).name
  return typeof name === "string" ? name : null
}

function getToolArguments(params: unknown) {
  if (!params || typeof params !== "object" || !("arguments" in params)) {
    return {}
  }
  return (params as { arguments?: unknown }).arguments ?? {}
}

function normalizeJsonRpcRequest(body: unknown): JsonRpcRequest {
  if (!body || typeof body !== "object" || Array.isArray(body)) return {}
  return body as JsonRpcRequest
}

function jsonRpcError(id: unknown, code: number, message: string) {
  return {
    jsonrpc: JSONRPC_VERSION,
    id: id ?? null,
    error: {
      code,
      message,
    },
  }
}

function jsonRpcResult(id: unknown, result: unknown) {
  return {
    jsonrpc: JSONRPC_VERSION,
    id: id ?? null,
    result,
  }
}

function toolError(id: unknown, error: unknown) {
  if (error instanceof z.ZodError) {
    return jsonRpcError(id, -32602, "Invalid tool arguments.")
  }
  if (error instanceof ForbiddenError || error instanceof AdminMcpAuthError) {
    return jsonRpcError(id, -32003, "Forbidden.")
  }
  if (error instanceof NotFoundError) {
    return jsonRpcError(id, -32004, error.message)
  }
  if (error instanceof Error && error.message === "not_implemented") {
    return jsonRpcError(id, -32601, "Admin MCP tool is not implemented yet.")
  }
  return jsonRpcError(id, -32603, "Admin MCP tool failed.")
}

function authErrorResponse(error: unknown, requiredScopes: readonly string[]) {
  if (error instanceof AdminMcpAuthError) {
    const status =
      error.code === "missing_token" || error.code === "invalid_token"
        ? 401
        : 403
    return Response.json(
      {
        error: error.code,
        error_description: error.message,
        required_scopes: error.requiredScopes,
      },
      {
        status,
        headers:
          status === 401
            ? {
                "www-authenticate": buildWwwAuthenticate(requiredScopes),
              }
            : undefined,
      },
    )
  }

  return Response.json(
    { error: "invalid_token", error_description: "Authorization failed." },
    { status: 401, headers: { "www-authenticate": buildWwwAuthenticate([]) } },
  )
}

function buildWwwAuthenticate(requiredScopes: readonly string[]) {
  const params = [
    `resource_metadata="${new URL(
      "/.well-known/oauth-protected-resource",
      getAdminMcpResourceUrl(),
    ).toString()}"`,
  ]
  if (requiredScopes.length > 0) {
    params.push(`scope="${requiredScopes.join(" ")}"`)
  }
  return `Bearer ${params.join(", ")}`
}

function unsupportedMediaType(): Response {
  return Response.json(
    { error: "Content-Type must be application/json" },
    { status: 415 },
  )
}

function badRequest(error: string): Response {
  return Response.json({ error }, { status: 400 })
}

function payloadTooLarge(): Response {
  return Response.json({ error: "JSON body is too large" }, { status: 413 })
}

async function readJsonBody(request: Request): Promise<unknown | Response> {
  const contentType = request.headers.get("content-type") ?? ""
  if (!/^\s*application\/json(?:\s*;|$)/i.test(contentType)) {
    return unsupportedMediaType()
  }

  const contentLength = request.headers.get("content-length")
  if (contentLength != null) {
    const declaredBytes = Number(contentLength)
    if (!Number.isFinite(declaredBytes) || declaredBytes < 0) {
      return badRequest("Content-Length must be a non-negative number")
    }
    if (declaredBytes > MAX_BODY_BYTES) return payloadTooLarge()
  }

  const body = request.body
  if (body == null) return badRequest("Invalid JSON body")

  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let totalBytes = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      totalBytes += value.byteLength
      if (totalBytes > MAX_BODY_BYTES) {
        await reader.cancel().catch(() => undefined)
        return payloadTooLarge()
      }
      chunks.push(value)
    }
  } catch {
    return badRequest("Invalid JSON body")
  }

  const bytes = new Uint8Array(totalBytes)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }

  try {
    return JSON.parse(new TextDecoder().decode(bytes))
  } catch {
    return badRequest("Invalid JSON body")
  }
}
