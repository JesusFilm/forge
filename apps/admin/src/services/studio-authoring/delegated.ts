import { StudioDelegatedNarrationService } from "./delegated-narration"
import { studioGenerationOutputSchema } from "@forge/studio-contracts/generation"
import type { PrismaClient } from "@prisma/client"
import { z } from "zod"
import { studioDelegatedRpcSchema } from "@forge/studio-contracts/agent"
import { StudioBoundaryError, type StudioCaller } from "@forge/studio-server"
import { interactiveStudioPrincipal, executeStudioRpc } from "./interactive"
import { StudioAuthoringService } from "./index"
import { StudioDraftRenderService } from "./draft-render"
import { studioRequestSchema } from "@forge/studio-contracts"
import { studioIdSchema } from "@forge/studio-contracts"

export async function executeStudioDelegated(
  db: PrismaClient,
  caller: StudioCaller,
  raw: unknown,
) {
  if (caller.authority !== "delegated")
    throw new StudioBoundaryError("Delegated authority required")
  const principal = {
    ...(await interactiveStudioPrincipal(db, caller.sub)),
    studioAuthority: "delegated" as const,
    studioClientId: caller.clientId,
  }
  const { action, input } = studioDelegatedRpcSchema.parse(raw)
  const scope =
    action === "narration-admit"
      ? "shorts:narration"
      : action === "render-request"
        ? "shorts:render"
        : ["apply", "create", "capture", "asset-upload"].includes(action)
          ? "shorts:edit"
          : action === "request"
            ? "shorts:chat"
            : "shorts:read"
  if (
    !caller.scopes.includes(scope) ||
    (action === "narration-admit" && !caller.scopes.includes("shorts:read"))
  )
    throw new StudioBoundaryError("Insufficient Studio scope")
  if (action === "narration-admit")
    return new StudioDelegatedNarrationService(db).admit(principal, input)
  const commands = new StudioAuthoringService(db)
  const renders = new StudioDraftRenderService(db)
  if (action === "render-request") return renders.request(principal, input)
  if (action === "render-status") return renders.status(principal, input)
  if (action === "render-read") return renders.read(principal, input)
  if (action === "request") {
    const request = studioRequestSchema
      .extend({ kind: z.literal("GENERATION") })
      .strict()
      .parse(input)
    return commands.request(principal, request)
  }
  if (action === "attempts")
    return commands.attempts(principal, studioIdSchema.parse(input))
  return executeStudioRpc(db, principal, { action, input })
}
export const studioFinishSchema = z
  .object({
    action: z.literal("finish"),
    input: z.unknown(),
    generation: studioGenerationOutputSchema.optional(),
  })
  .strict()
