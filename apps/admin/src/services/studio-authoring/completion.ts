import type { Prisma } from "@prisma/client"
import {
  studioCompleteSchema,
  studioDocumentSchema,
} from "@forge/studio-contracts"
import type { Principal } from "@/auth/principal"
import { ForbiddenError, NotFoundError } from "../errors"
import { StudioCommandError } from "./errors"
import {
  studioActor,
  studioHash,
  lockProject,
  receipt,
  saveReceipt,
} from "./state"
import { applyOperations } from "./operations"
import { resolveStudioPackSources } from "./packs"
import { resolveStudioDocumentSources } from "./sources"
import { attachStudioNarration, StudioTimingConflict } from "./narration"

/** Shared transactional completion. Render lease identity is supplied only by
 * the canonical render-job service, never by authoring clients. */
export async function completeStudioAttempt(
  tx: Prisma.TransactionClient,
  user: Principal | null,
  raw: unknown,
  renderFence?: { leaseId: string } | { abandon: true },
) {
  const actor = studioActor(user)
  if (actor.kind !== "service")
    throw new ForbiddenError("Only a trusted worker can complete an attempt")
  const input = studioCompleteSchema.parse(raw)
  const project = await lockProject(tx, input.projectId)
  const hash = studioHash({ command: "complete", actor, input })
  const retry = await receipt(tx, project.id, input.idempotencyKey, hash)
  if (retry) return retry
  const attempt = await tx.studioAttempt.findUnique({
    where: { id: input.attemptId },
  })
  if (!attempt || attempt.projectId !== project.id)
    throw new NotFoundError("StudioAttempt")
  if (
    attempt.baseRevision !== input.expectedRevision ||
    !["QUEUED", "RUNNING"].includes(attempt.status)
  )
    throw new StudioCommandError("CONFLICT")
  if (attempt.kind === "RENDER") {
    await tx.$queryRaw`SELECT attempt_id FROM studio_render_job WHERE attempt_id=${attempt.id} FOR UPDATE`
    const job = await tx.studioRenderJob.findUnique({
      where: { attemptId: attempt.id },
    })
    const abandoning =
      renderFence &&
      "abandon" in renderFence &&
      input.status === "FAILED" &&
      input.result.assets.length === 0 &&
      !input.result.manifest &&
      ["QUEUED", "RUNNING"].includes(job?.state ?? "")
    const ownsLease =
      renderFence &&
      "leaseId" in renderFence &&
      job?.state === "RUNNING" &&
      job.leaseId === renderFence.leaseId
    if (job && !abandoning && !ownsLease)
      throw new StudioCommandError("CONFLICT")
  }
  const stale =
    project.firstPublishedAt !== null ||
    project.currentRevision !== input.expectedRevision
  if (input.status !== "SUCCEEDED" && input.operations.length)
    throw new StudioCommandError("INVALID")
  if (attempt.kind !== "GENERATION" && input.operations.length)
    throw new StudioCommandError("INVALID")
  if (
    attempt.kind === "RENDER" &&
    input.status === "SUCCEEDED" &&
    !input.result.manifest
  )
    throw new StudioCommandError("INVALID")
  const productionRun =
    attempt.kind === "NARRATION"
      ? await tx.studioProductionRun.findUnique({
          where: { attemptId: attempt.id },
        })
      : null
  if (productionRun)
    await tx.$queryRaw`SELECT id FROM studio_production_run WHERE id=${productionRun.id} FOR UPDATE`
  const cancelled = productionRun
    ? (
        await tx.studioProductionRun.findUniqueOrThrow({
          where: { id: productionRun.id },
        })
      ).state === "CANCELLED"
    : false
  let revision = project.currentRevision
  let timingConflict: StudioTimingConflict | undefined
  let timingConflictIndices: number[] | undefined
  const attachingNarration =
    attempt.kind === "NARRATION" && !!input.result.manifest
  if (
    !cancelled &&
    !stale &&
    input.status === "SUCCEEDED" &&
    (input.operations.length || attachingNarration)
  ) {
    const previous = await tx.studioProjectRevision.findUniqueOrThrow({
      where: {
        projectId_number: { projectId: project.id, number: revision },
      },
    })
    let document = applyOperations(
      studioDocumentSchema.parse(previous.document),
      input.operations,
    )
    if (attachingNarration) {
      try {
        document = await attachStudioNarration(
          tx,
          document,
          input.result.manifest!,
        )
      } catch (error) {
        if (!(error instanceof StudioTimingConflict)) throw error
        timingConflict = error
        timingConflictIndices = document.items.flatMap((item, index) =>
          error.itemIds.includes(item.id) ? [index] : [],
        )
      }
    }
    if (!timingConflict) {
      await resolveStudioPackSources(tx, document.packRevisionIds)
      await resolveStudioDocumentSources(tx, document)
      revision += 1
      await tx.studioProjectRevision.create({
        data: { projectId: project.id, number: revision, document, actor },
      })
      await tx.studioProject.update({
        where: { id: project.id },
        data: { currentRevision: revision },
      })
    }
  }
  await tx.studioAttempt.update({
    where: { id: attempt.id },
    data: {
      status: cancelled ? "CANCELLED" : stale ? "STALE" : input.status,
      result: timingConflict
        ? {
            ...input.result,
            diagnostic: timingConflict.message,
            timingConflictIndices,
          }
        : input.result,
      completedBy: actor,
    },
  })
  if (productionRun && !cancelled)
    await tx.studioProductionRun.update({
      where: { id: productionRun.id },
      data: { state: "COMPLETED" },
    })
  const result = {
    projectId: project.id,
    revision,
    attemptId: attempt.id,
    outcome: stale ? ("STALE" as const) : ("ACCEPTED" as const),
    ...(timingConflict ? { timingConflicts: timingConflict.itemIds } : {}),
  }
  await saveReceipt(tx, project.id, input.idempotencyKey, hash, actor, result)
  return result
}
