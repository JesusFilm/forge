import {
  inspectStudioRender,
  studioInspectionMcpResult,
} from "@/services/studio-inspection"
import { after } from "next/server"
import {
  delegatedNarrationQuote,
  executeDelegatedNarration,
} from "@/services/studio-production/delegated-narration"
import { env } from "@/config/env"
import { z } from "zod"
import { STUDIO_MCP_TOOLS as tools } from "@/services/studio-agent/mcp-tools"
import {
  projectReviewLink,
  resolveProjectLink,
  withProjectLink,
} from "@/services/studio-agent/project-links"
import { readStudioBytes, StudioBoundaryError } from "@forge/studio-server"
import {
  authenticateStudioMcp,
  studioMcpAudience,
} from "@/services/studio-agent/oauth"
import { studioServiceCall } from "@/services/studio-agent/transport"
import { studioChat } from "@/services/studio-agent/chat"

export async function POST(request: Request) {
  let rpcId: string | number | null = null
  try {
    const rpc = z
      .object({
        jsonrpc: z.literal("2.0"),
        id: z.union([z.string(), z.number()]).optional(),
        method: z.string(),
        params: z.unknown().optional(),
      })
      .strict()
      .parse(JSON.parse(await readStudioBytes(request)))
    rpcId = rpc.id ?? null
    const call =
      rpc.method === "tools/call"
        ? z
            .object({ name: z.string(), arguments: z.unknown().optional() })
            .parse(rpc.params)
        : null
    const tool = call ? tools.find((t) => t.name === call.name) : undefined
    const caller = await authenticateStudioMcp(
      request,
      tool?.scope ?? "shorts:read",
    )
    if (rpc.method === "notifications/initialized")
      return new Response(null, { status: 202 })
    let result: unknown
    if (rpc.method === "initialize")
      result = {
        protocolVersion: "2025-03-26",
        capabilities: { tools: {} },
        serverInfo: { name: "Forge Shorts", version: "1.0.0" },
        instructions:
          "Edits use expectedRevision. Tools never grant interactive human review, experimentation or publication authority.",
      }
    else if (rpc.method === "ping") result = {}
    else if (rpc.method === "tools/list")
      result = {
        tools: tools
          .filter((t) => caller.scopes.includes(t.scope))
          .map((t) => ({
            name: t.name,
            description: t.description,
            inputSchema: z.toJSONSchema(t.schema),
          })),
      }
    else if (call && tool) {
      const input = tool.schema.parse(call.arguments ?? {})
      let value: unknown
      if (tool.action === "inspect") {
        const inspected = await inspectStudioRender(
          (action, input, signal) =>
            studioServiceCall("admin", caller, { action, input }, signal),
          input,
          request.signal,
        )
        return Response.json(
          {
            jsonrpc: "2.0",
            id: rpc.id ?? null,
            result: studioInspectionMcpResult(inspected),
          },
          { headers: { "cache-control": "no-store" } },
        )
      }
      if (tool.action === "narration-quote")
        value = await delegatedNarrationQuote(
          caller,
          z
            .object({ projectId: z.string(), expectedRevision: z.number() })
            .parse(input),
        )
      else if (tool.action === "narration-admit") {
        value = await studioServiceCall("admin", caller, {
          action: "narration-admit",
          input,
        })
        const { runId } = z.object({ runId: z.string() }).parse(value)
        after(() => executeDelegatedNarration(caller, runId))
      } else if (tool.action === "instructions")
        value = await studioServiceCall("mastra", caller, {
          action: "instructions",
          command: { action: "inspect" },
        })
      else if (tool.action === "resolve-project") {
        const { url } = z.object({ url: z.string() }).parse(input)
        value = await studioServiceCall("admin", caller, {
          action: "read",
          input: resolveProjectLink(url),
        })
      } else if (tool.action === "chat") {
        const response = await studioChat(caller, input, request.signal)
        value = {
          events: (await readStudioBytes(response, 262144))
            .trim()
            .split("\n")
            .map((line) => JSON.parse(line) as unknown),
        }
      } else
        value = await studioServiceCall("admin", caller, {
          action: tool.action,
          input:
            tool.action === "read"
              ? z.object({ projectId: z.string() }).parse(input).projectId
              : ["source", "pack"].includes(tool.action)
                ? z.object({ id: z.string() }).parse(input).id
                : input,
        })
      if (["asset-read", "asset-upload"].includes(tool.action)) {
        const transfer = z
          .object({
            path: z
              .string()
              .regex(/^\/api\/shorts\/assets\/transfer\/[a-f0-9]{64}$/),
          })
          .parse(value)
        value = {
          ...z.record(z.string(), z.unknown()).parse(value),
          url: new URL(transfer.path, env.ADMIN_GRAPHQL_URL!).toString(),
        }
      }
      if (
        ["render-request", "render-status", "render-read"].includes(tool.action)
      ) {
        const render = z
          .object({
            projectId: z.string(),
            revision: z.number(),
            attemptId: z.string(),
          })
          .passthrough()
          .parse(value)
        const review = new URL(
          projectReviewLink(render.projectId, render.revision),
        )
        review.searchParams.set("renderAttemptId", render.attemptId)
        value = { ...render, reviewUrl: review.toString() }
        if (tool.action === "render-read") {
          const access = z
            .object({
              path: z
                .string()
                .regex(/^\/api\/shorts\/assets\/transfer\/[a-f0-9]{64}$/),
            })
            .passthrough()
            .parse(render.access)
          value = {
            ...render,
            reviewUrl: review.toString(),
            access: {
              ...access,
              url: new URL(access.path, env.ADMIN_GRAPHQL_URL!).toString(),
            },
          }
        }
      }
      if (tool.action === "list") {
        const projects = z
          .array(
            z
              .object({ projectId: z.string(), revision: z.number() })
              .passthrough(),
          )
          .parse(value)
        const limit = z.object({ limit: z.number() }).parse(input).limit
        value = {
          projects: projects.map(withProjectLink),
          nextCursor:
            projects.length === limit ? projects.at(-1)!.projectId : null,
        }
      } else if (
        ["create", "read", "apply", "resolve-project"].includes(tool.action)
      ) {
        value = withProjectLink(
          z
            .object({ projectId: z.string(), revision: z.number() })
            .passthrough()
            .parse(value),
        )
      } else if (tool.action === "history") {
        const { projectId } = z.object({ projectId: z.string() }).parse(input)
        value = z
          .array(z.object({ revision: z.number() }).passthrough())
          .parse(value)
          .map((revision) => ({
            ...revision,
            reviewUrl: projectReviewLink(projectId, revision.revision),
          }))
      }
      result = {
        content: [{ type: "text", text: JSON.stringify(value) }],
        structuredContent: { result: value },
      }
    } else
      return Response.json({
        jsonrpc: "2.0",
        id: rpc.id ?? null,
        error: { code: -32601, message: "Method or tool unavailable" },
      })
    return Response.json(
      { jsonrpc: "2.0", id: rpc.id ?? null, result },
      { headers: { "cache-control": "no-store" } },
    )
  } catch (e) {
    if (e instanceof StudioBoundaryError && e.status === 409) {
      const conflict = {
        code: "CONFLICT",
        retryable: true,
        recovery:
          "Read the project and history, preserve human changes, and reapply against the new expectedRevision with a new idempotencyKey.",
      }
      return Response.json(
        {
          jsonrpc: "2.0",
          id: rpcId,
          result: {
            isError: true,
            content: [{ type: "text", text: JSON.stringify(conflict) }],
            structuredContent: { result: conflict },
          },
        },
        { headers: { "cache-control": "no-store" } },
      )
    }
    const status = e instanceof StudioBoundaryError ? e.status : 400
    return Response.json(
      {
        error:
          e instanceof StudioBoundaryError ? e.message : "Invalid MCP request",
      },
      {
        status,
        headers: {
          "cache-control": "no-store",
          "www-authenticate": `Bearer resource_metadata="${new URL("/.well-known/oauth-protected-resource", studioMcpAudience())}"`,
        },
      },
    )
  }
}
export function GET() {
  return new Response(null, { status: 405, headers: { Allow: "POST" } })
}
