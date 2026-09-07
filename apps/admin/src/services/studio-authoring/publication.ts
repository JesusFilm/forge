import {
  studioSchedulePublicationBindingSchema,
  studioPublishSchema,
} from "@forge/studio-contracts/publication"
import type { StudioScheduledPublication } from "./scheduled-publication"
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
  type StudioCommandResult,
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
import { StudioCommandError, StudioPublicationRejected } from "./errors"
import { publicationDependencyHash } from "./state"

const commitSchema = studioCommandBaseSchema.extend({
  approvalId: studioIdSchema,
  renderAttemptId: studioIdSchema,
  releaseId: studioIdSchema.optional(),
  readinessId: studioIdSchema.optional(),
  schedule: studioSchedulePublicationBindingSchema.optional(),
})
export type StudioPublicationVerifier = (
  tx: Prisma.TransactionClient,
  snapshot: {
    projectId: string
    revision: number
    document: StudioDocument
    renderAttemptId: string
    publishedAt: Date
    restrictions: string[]
  },
) => Promise<void | (() => void)>

export async function publishStudioProject(
  db: PrismaClient,
  user: Principal | null,
  raw: unknown,
  verify: StudioPublicationVerifier,
  scheduled?: StudioScheduledPublication,
): Promise<StudioCommandResult> {
  const actor = studioActor(user)
  if (
    (scheduled
      ? actor.kind !== "service" || typeof scheduled.consume !== "function"
      : !canReviewStudio(user)) ||
    typeof verify !== "function"
  )
    throw new ForbiddenError(
      "Publication verifier and human authority required",
    )
  const input = scheduled
    ? studioPublishSchema.parse(raw)
    : commitSchema.parse(raw)
  if (
    !!input.schedule !== !!scheduled ||
    (scheduled && studioHash(input) !== studioHash(scheduled.input))
  )
    throw new ForbiddenError("Trusted schedule binding required")
  return db.$transaction(async (tx) => {
    const project = await lockProject(tx, input.projectId)
    const hash = studioHash({ command: "publish", actor, input })
    const retry = await receipt(tx, project.id, input.idempotencyKey, hash)
    if (retry) return retry
    try {
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
      const packs = await resolveStudioPackSources(tx, document.packRevisionIds)
      const sources = await assertStudioRenderSources(tx, document)
      const restrictions = [
        ...new Set([
          ...sources.flatMap((source) => source.eligibility.restrictions),
          ...packs.flatMap((pack) =>
            pack.sources.flatMap((source) => source.eligibility.restrictions),
          ),
        ]),
      ].sort()
      const publishedAt = new Date()
      const assertDeliveryWindow = (now: Date) => {
        if (!input.schedule) return
        if (Date.parse(input.schedule.dueAt) > now.getTime())
          throw new StudioCommandError("NOT_DUE")
        if (Date.parse(input.schedule.latestAllowedAt) < now.getTime())
          throw new StudioCommandError("DELIVERY_EXPIRED")
      }
      if (scheduled) {
        assertDeliveryWindow(publishedAt)
        await scheduled.consume(tx, scheduled.input, publishedAt)
        assertDeliveryWindow(new Date())
      }
      const assertVerifiedCurrent = await verify(tx, {
        projectId: project.id,
        revision: project.currentRevision,
        document,
        renderAttemptId: input.renderAttemptId,
        publishedAt,
        restrictions,
      })
      assertDeliveryWindow(new Date())
      await tx.studioProject.update({
        where: { id: project.id },
        data: { lifecycle: "PUBLISHED", firstPublishedAt: publishedAt },
      })
      const result = {
        projectId: project.id,
        revision: project.currentRevision,
        outcome: "ACCEPTED" as const,
      }
      await saveReceipt(
        tx,
        project.id,
        input.idempotencyKey,
        hash,
        actor,
        result,
      )
      // Last server decision after all callback and persistence waits. Commit
      // itself is outside this callback; this is not a commit-instant guarantee.
      assertDeliveryWindow(new Date())
      if (assertVerifiedCurrent) assertVerifiedCurrent()
      return result
    } catch (error) {
      if (error instanceof StudioCommandError)
        throw new StudioPublicationRejected(error)
      throw error
    }
  })
}
