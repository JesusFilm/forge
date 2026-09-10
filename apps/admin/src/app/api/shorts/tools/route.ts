import { studioProjectSchema } from "@forge/studio-contracts"
import { studioSourcePreviewSchema } from "@forge/studio-contracts/sources"
import {
  studioValidateProposalSchema,
  StudioCoverageError,
  studioCoverageRejectionSchema,
  StudioProposalFieldError,
  studioProposalFieldRejectionSchema,
} from "@forge/studio-contracts/production"
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
      "source-preview",
      "search",
      "capture",
      "asset-upload",
      "validate-proposal",
    ]),
    input: z.unknown(),
  })
  .strict()
export async function POST(request: Request) {
  let admittedProposal = false
  try {
    const input = schema.parse(JSON.parse(await readStudioBytes(request)))
    const caller = await verifyStudioRequest(
      input.grant.assertion,
      input.grant.body,
      "forge-admin:shorts:tools",
      {
        publicKeys: env.STUDIO_INTERACTIVE_PUBLIC_KEYS ?? "{}",
        environment: env.STUDIO_ENVIRONMENT,
      },
    )
    const grant = z
      .object({ projectId: z.string(), revision: z.number().int() })
      .strict()
      .parse(JSON.parse(input.grant.body))
    const project = studioProjectSchema.parse(
      await executeStudioDelegated(prisma, caller, {
        action: "read",
        input: grant.projectId,
      }),
    )
    if (project.revision !== grant.revision)
      throw new StudioBoundaryError("CONFLICT", 409)
    if (input.action === "source-preview") {
      const preview = studioSourcePreviewSchema.parse(input.input)
      if (preview.language !== project.document.language)
        throw new StudioBoundaryError(
          "Source language differs from admitted project",
        )
    }
    if (input.action === "validate-proposal") {
      const proposed = studioValidateProposalSchema.parse(input.input)
      if (
        proposed.command.projectId !== grant.projectId ||
        proposed.command.expectedRevision !== grant.revision
      )
        throw new StudioBoundaryError("Proposal outside admitted project")
      admittedProposal = true
    }
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
    if (admittedProposal && e instanceof StudioProposalFieldError) {
      const rejection = studioProposalFieldRejectionSchema.safeParse({
        error: "Studio proposal fields rejected",
        feedback: e.feedback,
      })
      if (rejection.success)
        return Response.json(rejection.data, {
          status: 400,
          headers: { "cache-control": "no-store" },
        })
    }
    if (e instanceof StudioCoverageError)
      return Response.json(
        studioCoverageRejectionSchema.parse({
          error: "Studio role coverage rejected",
          feedback: e.feedback,
        }),
        { status: 400, headers: { "cache-control": "no-store" } },
      )
    return Response.json(
      {
        error:
          e instanceof StudioBoundaryError ? e.message : "Studio tool rejected",
      },
      { status: e instanceof StudioBoundaryError ? e.status : 400 },
    )
  }
}
