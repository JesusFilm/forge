import { StudioBoundaryError } from "@forge/studio-server"
import { studioAssetTools } from "./tools"
import { Agent, type AgentConfig } from "@mastra/core/agent"
import { createTool } from "@mastra/core/tools"
import { z } from "zod"
import {
  studioOperationSchema,
  type StudioProject,
} from "@forge/studio-contracts"
import type { StudioAgentEvent } from "@forge/studio-contracts/agent"
import type { FrozenStudioInstructions } from "./instructions"
import { studioQualityReportSchema } from "@forge/studio-contracts/production"

/** Per-run unregistered agent: no framework route, Workspace, memory, or editable tool registry. */
export async function streamStudioAgent(input: {
  frozen: FrozenStudioInstructions
  project: StudioProject
  message: string
  model: AgentConfig["model"]
  emit: (event: StudioAgentEvent) => void
  assetCall?: (action: string, input: unknown) => Promise<unknown>
  signal: AbortSignal
}) {
  const agent = new Agent({
    id: `studio-run-${crypto.randomUUID()}`,
    name: "Studio authoring",
    instructions: input.frozen.effective,
    model: input.model,
    editor: false,
    tools: {
      ...(input.assetCall ? studioAssetTools(input.assetCall) : {}),
      readProject: createTool({
        id: "readProject",
        description: "Read the admitted project revision and asset references.",
        inputSchema: z.object({}).strict(),
        execute: async () => input.project,
      }),
      proposeEdits: createTool({
        id: "proposeEdits",
        description:
          "Propose bounded edits to the admitted revision for the operator to accept. Does not apply changes or approve anything.",
        inputSchema: z
          .object({
            summary: z.string().min(1).max(2000),
            operations: z.array(studioOperationSchema).min(1).max(100),
            quality: studioQualityReportSchema.optional(),
          })
          .strict(),
        execute: async ({ summary, operations, quality }) => {
          const command = {
            projectId: input.project.projectId,
            expectedRevision: input.project.revision,
            idempotencyKey: crypto.randomUUID(),
            operations,
          }
          if (!input.assetCall)
            throw new StudioBoundaryError(
              "Canonical proposal validation unavailable",
            )
          await input.assetCall("validate-proposal", { command, quality })
          input.emit({
            type: "proposal",
            proposal: {
              summary,
              command,
              quality,
            },
          })
          return { proposed: true, applied: false }
        },
      }),
    },
  })
  const stream = await agent.stream(input.message, {
    maxSteps: 5,
    modelSettings: { maxOutputTokens: 4096, maxRetries: 0 },
    abortSignal: input.signal,
  })
  let length = 0
  for await (const chunk of stream.fullStream) {
    if (chunk.type === "text-delta") {
      const text = chunk.payload.text
      length += text.length
      if (length > 16000)
        throw new StudioBoundaryError("Studio response exceeded its limit")
      input.emit({ type: "text", text })
    }
    if (chunk.type === "error")
      throw new StudioBoundaryError("Studio generation failed")
  }
}
