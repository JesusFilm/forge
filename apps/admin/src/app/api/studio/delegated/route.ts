import {
  executeStudioRender,
  studioRenderRpcSchema,
} from "@/services/studio-authoring/render-rpc"
import { StudioGenerationService } from "@/services/studio-authoring/generation"
import {
  executeStudioProduction,
  studioProductionRpcSchema,
} from "@/services/studio-authoring/production-rpc"
import { prisma } from "@/db/client"
import { env } from "@/config/env"
import {
  verifyStudioRequest,
  readStudioBytes,
  StudioBoundaryError,
} from "@forge/studio-server"
import {
  executeStudioDelegated,
  studioFinishSchema,
} from "@/services/studio-authoring/delegated"
import {
  StudioAuthoringService,
  StudioCommandError,
} from "@/services/studio-authoring"
export async function POST(request: Request) {
  try {
    const body = await readStudioBytes(request)
    const caller = await verifyStudioRequest(
      request.headers.get("x-forge-studio-service"),
      body,
      "forge-admin:studio:delegated",
      {
        publicKeys: env.STUDIO_INTERACTIVE_PUBLIC_KEYS ?? "{}",
        environment: env.STUDIO_ENVIRONMENT,
      },
    )
    const raw: unknown = JSON.parse(body),
      finish = studioFinishSchema.safeParse(raw)
    let result: unknown
    if (finish.success) {
      if (
        !caller.scopes.includes("studio:attempt:finish") ||
        caller.authority !== "delegated" ||
        caller.clientId !== "studio-hosted"
      )
        throw new StudioBoundaryError("Trusted completion required")
      result = finish.data.generation
        ? await new StudioGenerationService(prisma).complete(
            { id: null, role: "MANAGER_BACKEND" },
            finish.data.input,
            finish.data.generation,
          )
        : await new StudioAuthoringService(prisma).complete(
            { id: null, role: "MANAGER_BACKEND" },
            finish.data.input,
          )
    } else if (studioRenderRpcSchema.safeParse(raw).success)
      result = await executeStudioRender(prisma, caller, raw)
    else if (studioProductionRpcSchema.safeParse(raw).success)
      result = await executeStudioProduction(prisma, caller, raw)
    else result = await executeStudioDelegated(prisma, caller, raw)
    return Response.json(
      { result },
      { headers: { "cache-control": "no-store" } },
    )
  } catch (error) {
    const conflict =
      error instanceof StudioCommandError && error.code === "CONFLICT"
    return Response.json(
      {
        error:
          error instanceof StudioCommandError
            ? error.code
            : error instanceof StudioBoundaryError
              ? error.message
              : "Studio command rejected",
      },
      {
        status: conflict
          ? 409
          : error instanceof StudioBoundaryError
            ? error.status
            : 400,
      },
    )
  }
}
