import { env } from "@/config/env"
import { studioAssetReferenceSchema } from "@forge/studio-contracts"
import { studioAssetUploadSchema } from "@forge/studio-contracts/assets"
import {
  studioCaptureSourceSchema,
  studioSourcePreviewSchema,
} from "@forge/studio-contracts/sources"
import { z } from "zod"
import {
  studioApplySchema,
  studioCreateSchema,
  studioIdSchema,
} from "@forge/studio-contracts"
import { studioChatSchema } from "@forge/studio-contracts/agent"
import { readStudioBytes, StudioBoundaryError } from "@forge/studio-server"
import {
  authenticateStudioMcp,
  studioMcpAudience,
} from "@/services/studio-agent/oauth"
import { studioServiceCall } from "@/services/studio-agent/transport"
import { studioChat } from "@/services/studio-agent/chat"
const tools = [
  {
    name: "shorts.sourcePreview",
    description:
      "Read a bounded page of exact-language retained canonical subtitle cues. Follow nextOffset until null for complete range coverage.",
    scope: "shorts:read",
    action: "source-preview",
    schema: studioSourcePreviewSchema,
  },
  {
    name: "shorts.assets",
    description: "Discover shared assets and immutable versions.",
    scope: "shorts:read",
    action: "assets",
    schema: z
      .object({
        search: z.string().max(200).optional(),
        limit: z.number().int().min(1).max(100).optional(),
      })
      .strict(),
  },
  {
    name: "shorts.asset",
    description: "Read asset metadata by exact immutable reference.",
    scope: "shorts:read",
    action: "asset",
    schema: studioAssetReferenceSchema,
  },
  {
    name: "shorts.packs",
    description: "Discover reusable Content Packs.",
    scope: "shorts:read",
    action: "packs",
    schema: z.object({ search: z.string().max(200).optional() }).strict(),
  },
  {
    name: "shorts.pack",
    description:
      "Read immutable Content Pack evidence and separate editorial guidance.",
    scope: "shorts:read",
    action: "pack",
    schema: z.object({ id: studioIdSchema }).strict(),
  },
  {
    name: "shorts.search",
    description:
      "Find exact-language video/dub/edition, subtitle and download identities for source capture.",
    scope: "shorts:read",
    action: "search",
    schema: z
      .object({ search: z.string().max(200), language: studioIdSchema })
      .strict(),
  },
  {
    name: "shorts.capture",
    description:
      "Capture canonical source and subtitle identity, never a caller URL or replacement transcription. Media materialization remains a trusted broker step.",
    scope: "shorts:edit",
    action: "capture",
    schema: studioCaptureSourceSchema,
  },
  {
    name: "shorts.source",
    description: "Read canonical source snapshot.",
    scope: "shorts:read",
    action: "source",
    schema: z.object({ id: studioIdSchema }).strict(),
  },
  {
    name: "shorts.assetRead",
    description:
      "Issue a five-minute scoped byte-read capability. Do not log or persist its URL.",
    scope: "shorts:read",
    action: "asset-read",
    schema: studioAssetReferenceSchema,
  },
  {
    name: "shorts.assetUpload",
    description:
      "Issue a five-minute digest/size-bound PUT capability for a component or other asset. Upload bytes to receive the durable reference; add declarations/items with shorts.apply. Never trust generated code as codec proof.",
    scope: "shorts:edit",
    action: "asset-upload",
    schema: studioAssetUploadSchema,
  },
  {
    name: "shorts.read",
    description: "Read a Shorts project revision and attributed state.",
    scope: "shorts:read",
    action: "read",
    schema: z.object({ projectId: studioIdSchema }).strict(),
  },
  {
    name: "shorts.history",
    description: "Read attributed revision history for undo/reconciliation.",
    scope: "shorts:read",
    action: "history",
    schema: z.object({ projectId: studioIdSchema }).strict(),
  },
  {
    name: "shorts.apply",
    description:
      "Apply revision-checked draft operations. Never reviews, publishes or activates instructions.",
    scope: "shorts:edit",
    action: "apply",
    schema: studioApplySchema,
  },
  {
    name: "shorts.create",
    description: "Create a standalone draft project.",
    scope: "shorts:edit",
    action: "create",
    schema: studioCreateSchema,
  },
  {
    name: "shorts.instructions",
    description:
      "Inspect native Shorts guidance and version identities without activation authority.",
    scope: "shorts:instructions:read",
    action: "instructions",
    schema: z.object({}).strict(),
  },
  {
    name: "shorts.chat",
    description:
      "Run the hosted Shorts agent and return its streamed diagnostics and proposed changes. Apply proposals separately; narration and publication are unavailable.",
    scope: "shorts:chat",
    action: "chat",
    schema: studioChatSchema,
  },
] as const
export async function POST(request: Request) {
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
          "Edits use expectedRevision. Tools never grant interactive human review, experimentation, narration or publication authority.",
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
      if (tool.action === "instructions")
        value = await studioServiceCall("mastra", caller, {
          action: "instructions",
          command: { action: "inspect" },
        })
      else if (tool.action === "chat") {
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
