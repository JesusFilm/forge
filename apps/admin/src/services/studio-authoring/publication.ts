import { canReviewStudio } from "@/auth/permissions"
import { resolveStudioPackSources } from "./packs"
import { assertStudioRenderSources } from "./sources"
// INTERNAL transaction seam for feat-460. Never export via GraphQL, MCP, or Manager.
// The required verifier must check/write catalog visibility, source eligibility,
// schedule, language and Mux readiness in THIS transaction. No network/render work.
import type { Prisma, PrismaClient } from "@prisma/client"
import {
  studioCommandBaseSchema,
  studioIdSchema,
  studioDocumentSchema,
  type StudioDocument,
} from "@forge/studio-contracts"
import type { Principal } from "@/auth/principal"
import { ForbiddenError } from "../errors"
import {
  assertEditable,
  lockProject,
  receipt,
  saveReceipt,
  studioActor,
  studioHash,
} from "./state"
import { StudioCommandError } from "./errors"
import { publicationDependencyHash } from "./state"

const commitSchema = studioCommandBaseSchema.extend({
  approvalId: studioIdSchema,
  renderAttemptId: studioIdSchema,
})
export type StudioPublicationVerifier = (
  tx: Prisma.TransactionClient,
  snapshot: {
    projectId: string
    revision: number
    document: StudioDocument
    renderAttemptId: string
  },
) => Promise<void>

export async function publishStudioProject(
  db: PrismaClient,
  user: Principal | null,
  raw: unknown,
  verify: StudioPublicationVerifier,
) {
  const actor = studioActor(user)
  if (!canReviewStudio(user) || typeof verify !== "function")
    throw new ForbiddenError(
      "Publication verifier and human authority required",
    )
  const input = commitSchema.parse(raw)
  return db.$transaction(async (tx) => {
    const project = await lockProject(tx, input.projectId)
    const hash = studioHash({ command: "publish", actor, input })
    const retry = await receipt(tx, project.id, input.idempotencyKey, hash)
    if (retry) return retry
    assertEditable(project, input.expectedRevision)
    const revision = await tx.studioProjectRevision.findUniqueOrThrow({
      where: {
        projectId_number: {
          projectId: project.id,
          number: project.currentRevision,
        },
      },
    })
    const document = studioDocumentSchema.parse(revision.document)
    const dependencyHash = await publicationDependencyHash(
      tx,
      project,
      document,
      input.renderAttemptId,
    )
    const approval = await tx.studioApproval.findUnique({
      where: { id: input.approvalId },
    })
    if (
      !approval ||
      approval.projectId !== project.id ||
      approval.revision !== project.currentRevision ||
      approval.kind !== "PUBLICATION" ||
      approval.renderAttemptId !== input.renderAttemptId ||
      approval.dependencyHash !== dependencyHash
    )
      throw new StudioCommandError("APPROVAL_REQUIRED")
    await resolveStudioPackSources(tx, document.packRevisionIds)
    await assertStudioRenderSources(tx, document)
    await verify(tx, {
      projectId: project.id,
      revision: project.currentRevision,
      document,
      renderAttemptId: input.renderAttemptId,
    })
    await tx.studioProject.update({
      where: { id: project.id },
      data: { lifecycle: "PUBLISHED", firstPublishedAt: new Date() },
    })
    const result = {
      projectId: project.id,
      revision: project.currentRevision,
      outcome: "ACCEPTED" as const,
    }
    await saveReceipt(tx, project.id, input.idempotencyKey, hash, actor, result)
    return result
  })
}
