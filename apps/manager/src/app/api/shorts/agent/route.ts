import { NextResponse } from "next/server"
import { z } from "zod"
import { authenticateStudioRequest } from "@/lib/studio-request"
import {
  readStudioBytes,
  StudioBoundaryError,
  type StudioCaller,
} from "@forge/studio-server"
import {
  studioChatSchema,
  studioRuntimeRequestSchema,
} from "@forge/studio-contracts/agent"
import { studioApplySchema } from "@forge/studio-contracts"
import {
  studioServiceRequest,
  studioServiceCall,
} from "@/services/studio-agent/transport"
import { studioChat } from "@/services/studio-agent/chat"
const schema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("chat"), input: studioChatSchema }).strict(),
  z.object({ kind: z.literal("apply"), input: studioApplySchema }).strict(),
  z
    .object({
      kind: z.literal("instructions"),
      input: studioRuntimeRequestSchema,
    })
    .strict(),
])
export async function POST(request: Request) {
  const actor = await authenticateStudioRequest(request)
  if (actor instanceof NextResponse) return actor
  try {
    const input = schema.parse(JSON.parse(await readStudioBytes(request)))
    const caller: StudioCaller = {
      sub: actor.approvedByUserId,
      authority: "interactive",
      clientId: "shorts-manager",
      scopes: [
        "shorts:read",
        "shorts:edit",
        "shorts:chat",
        "shorts:instructions:read",
      ],
    }
    if (input.kind === "chat")
      return await studioChat(caller, input.input, request.signal)
    if (input.kind === "apply")
      return Response.json({
        result: await studioServiceCall(
          "admin",
          { ...caller, authority: "delegated", clientId: "shorts-hosted" },
          { action: "apply", input: input.input },
        ),
      })
    if (!["instructions", "test"].includes(input.input.action))
      throw new StudioBoundaryError("Invalid instruction operation", 400)
    return await studioServiceRequest(
      "mastra",
      caller,
      input.input,
      request.signal,
    )
  } catch (e) {
    return Response.json(
      {
        error:
          e instanceof StudioBoundaryError
            ? e.message
            : "Invalid Shorts agent request",
      },
      { status: e instanceof StudioBoundaryError ? e.status : 400 },
    )
  }
}
