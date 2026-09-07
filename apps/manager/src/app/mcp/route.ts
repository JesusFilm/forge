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
    name: "studio.sourcePreview",
    description:
      "Read a bounded page of exact-language retained canonical subtitle cues. Follow nextOffset until null for complete range coverage.",
    scope: "studio:read",
    action: "source-preview",
    schema: studioSourcePreviewSchema,
  },
  {
    name: "studio.assets",
    description: "Discover shared assets and immutable versions.",
    scope: "studio:read",
    action: "assets",
    schema: z
      .object({
        search: z.string().max(200).optional(),
        limit: z.number().int().min(1).max(100).optional(),
      })
      .strict(),
  },
  {
    name: "studio.asset",
    description: "Read asset metadata by exact immutable reference.",
    scope: "studio:read",
    action: "asset",
    schema: studioAssetReferenceSchema,
  },
  {
    name: "studio.packs",
    description: "Discover reusable Content Packs.",
    scope: "studio:read",
    action: "packs",
    schema: z.object({ search: z.string().max(200).optional() }).strict(),
  },
  {
    name: "studio.pack",
    description:
      "Read immutable Content Pack evidence and separate editorial guidance.",
    scope: "studio:read",
    action: "pack",
    schema: z.object({ id: studioIdSchema }).strict(),
  },
  {
    name: "studio.search",
    description:
      "Find exact-language video/dub/edition, subtitle and download identities for source capture.",
    scope: "studio:read",
    action: "search",
    schema: z
      .object({ search: z.string().max(200), language: studioIdSchema })
      .strict(),
  },
  {
    name: "studio.capture",
    description:
      "Capture canonical source and subtitle identity, never a caller URL or replacement transcription. Media materialization remains a trusted broker step.",
    scope: "studio:edit",
    action: "capture",
    schema: studioCaptureSourceSchema,
  },
  {
    name: "studio.source",
    description: "Read canonical source snapshot.",
    scope: "studio:read",
    action: "source",
    schema: z.object({ id: studioIdSchema }).strict(),
  },
  {
    name: "studio.assetRead",
    description:
      "Issue a five-minute scoped byte-read capability. Do not log or persist its URL.",
    scope: "studio:read",
    action: "asset-read",
    schema: studioAssetReferenceSchema,
  },
  {
    name: "studio.assetUpload",
    description:
      "Issue a five-minute digest/size-bound PUT capability for a component or other asset. Upload bytes to receive the durable reference; add declarations/items with studio.apply. Never trust generated code as codec proof.",
    scope: "studio:edit",
    action: "asset-upload",
    schema: studioAssetUploadSchema,
  },
  {
    name: "studio.read",
    description: "Read a Studio project revision and attributed state.",
    scope: "studio:read",
    action: "read",
    schema: z.object({ projectId: studioIdSchema }).strict(),
  },
  {
    name: "studio.history",
    description: "Read attributed revision history for undo/reconciliation.",
    scope: "studio:read",
    action: "history",
    schema: z.object({ projectId: studioIdSchema }).strict(),
  },
  {
    name: "studio.apply",
    description:
      "Apply revision-checked draft operations. Never reviews, publishes or activates instructions.",
    scope: "studio:edit",
    action: "apply",
    schema: studioApplySchema,
  },
  {
    name: "studio.create",
    description: "Create a standalone draft project.",
    scope: "studio:edit",
    action: "create",
    schema: studioCreateSchema,
  },
  {
    name: "studio.instructions",
    description:
      "Inspect native Studio guidance and version identities without activation authority.",
    scope: "studio:instructions:read",
    action: "instructions",
    schema: z.object({}).strict(),
  },
  {
    name: "studio.chat",
    description:
      "Run the hosted Studio agent and return its streamed diagnostics and proposed changes. Apply proposals separately; narration and publication are unavailable.",
    scope: "studio:chat",
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
      tool?.scope ?? "studio:read",
    )
    if (rpc.method === "notifications/initialized")
      return new Response(null, { status: 202 })
    let result: unknown
    if (rpc.method === "initialize")
      result = {
        protocolVersion: "2025-03-26",
        capabilities: { tools: {} },
        serverInfo: { name: "Forge Studio", version: "1.0.0" },
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
              .regex(/^\/api\/studio\/assets\/transfer\/[a-f0-9]{64}$/),
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
