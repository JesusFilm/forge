import type { PrismaClient } from "@prisma/client"
import { z } from "zod"
import { studioDelegatedRpcSchema } from "@forge/studio-contracts/agent"
import { StudioBoundaryError, type StudioCaller } from "@forge/studio-server"
import { interactiveStudioPrincipal, executeStudioRpc } from "./interactive"
import { StudioAuthoringService } from "./index"
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
  const scope = ["apply", "create", "capture", "asset-upload"].includes(action)
    ? "studio:edit"
    : action === "request"
      ? "studio:chat"
      : "studio:read"
  if (!caller.scopes.includes(scope))
    throw new StudioBoundaryError("Insufficient Studio scope")
  const commands = new StudioAuthoringService(db)
  if (action === "request") return commands.request(principal, input)
  if (action === "attempts")
    return commands.attempts(principal, studioIdSchema.parse(input))
  return executeStudioRpc(db, principal, { action, input })
}
export const studioFinishSchema = z
  .object({ action: z.literal("finish"), input: z.unknown() })
  .strict()
