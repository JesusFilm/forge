import { z } from "zod"
import { prisma } from "@/db/client"
import { env } from "@/config/env"
import {
  readStudioBytes,
  verifyStudioRequest,
  StudioBoundaryError,
} from "@forge/studio-server"
import { executeStudioDelegated } from "@/services/studio-authoring/delegated"
const schema = z
  .object({
    grant: z
      .object({ body: z.string().max(2048), assertion: z.string().max(8192) })
      .strict(),
    action: z.enum([
      "assets",
      "asset",
      "packs",
      "pack",
      "source",
      "search",
      "capture",
      "asset-upload",
    ]),
    input: z.unknown(),
  })
  .strict()
export async function POST(request: Request) {
  try {
    const input = schema.parse(JSON.parse(await readStudioBytes(request)))
    const caller = await verifyStudioRequest(
      input.grant.assertion,
      input.grant.body,
      "forge-admin:studio:tools",
      {
        publicKeys: env.STUDIO_INTERACTIVE_PUBLIC_KEYS ?? "{}",
        environment: env.STUDIO_ENVIRONMENT,
      },
    )
    const grant = z
      .object({ projectId: z.string(), revision: z.number().int() })
      .strict()
      .parse(JSON.parse(input.grant.body))
    const project = z.object({ revision: z.number() }).parse(
      await executeStudioDelegated(prisma, caller, {
        action: "read",
        input: grant.projectId,
      }),
    )
    if (project.revision !== grant.revision)
      throw new StudioBoundaryError("CONFLICT", 409)
    return Response.json(
      {
        result: await executeStudioDelegated(prisma, caller, {
          action: input.action,
          input: input.input,
        }),
      },
      { headers: { "cache-control": "no-store" } },
    )
  } catch (e) {
    return Response.json(
      {
        error:
          e instanceof StudioBoundaryError ? e.message : "Studio tool rejected",
      },
      { status: e instanceof StudioBoundaryError ? e.status : 400 },
    )
  }
}
