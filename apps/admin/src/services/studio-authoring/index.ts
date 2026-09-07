import type { PrismaClient } from "@prisma/client"
import {
  studioActorSchema,
  studioCreateSchema,
  studioDocumentSchema,
  studioIdSchema,
  studioApplySchema,
  studioRequestSchema,
  studioCompleteSchema,
  studioAttemptSchema,
  studioApproveSchema,
  studioCommandBaseSchema,
  studioStartSchema,
  studioListSchema,
  studioProjectSummarySchema,
  studioProjectSchema,
  studioHistorySchema,
  studioRevisionSchema,
  studioApprovalSchema,
} from "@forge/studio-contracts"
import type { Principal } from "@/auth/principal"
import { ForbiddenError, NotFoundError } from "../errors"

import { StudioCommandError } from "./errors"
import {
  studioActor,
  studioHash,
  lockProject,
  assertEditable,
  receipt,
  saveReceipt,
  scriptHash,
  publicationDependencyHash,
} from "./state"
import { applyOperations } from "./operations"
export { StudioCommandError } from "./errors"
export class StudioAuthoringService {
  constructor(private readonly db: PrismaClient) {}
  async create(user: Principal | null, raw: unknown) {
    const actor = studioActor(user)
    const input = studioCreateSchema.parse(raw)
    return this.db.$transaction(async (tx) => {
      // Serializes creation of an absent ID. All existing-project writes hold its row lock.
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${input.projectId}, 454))::text`
      const hash = studioHash({ command: "create", actor, input })
      const retry = await receipt(
        tx,
        input.projectId,
        input.idempotencyKey,
        hash,
      )
      if (retry) return retry
      if (await tx.studioProject.findUnique({ where: { id: input.projectId } }))
        throw new StudioCommandError("CONFLICT")
      await tx.studioProject.create({
        data: { id: input.projectId, currentRevision: 1, ownerId: actor.id },
      })
      await tx.studioProjectRevision.create({
        data: {
          projectId: input.projectId,
          number: 1,
          document: input.document,
          actor,
        },
      })
      const result = {
        projectId: input.projectId,
        revision: 1,
        outcome: "ACCEPTED" as const,
      }
      await saveReceipt(
        tx,
        input.projectId,
        input.idempotencyKey,
        hash,
        actor,
        result,
      )
      return result
    })
  }
  async apply(user: Principal | null, raw: unknown) {
    const actor = studioActor(user)
    const input = studioApplySchema.parse(raw)
    return this.db.$transaction(async (tx) => {
      const project = await lockProject(tx, input.projectId)
      const hash = studioHash({ command: "apply", actor, input })
      const retry = await receipt(
        tx,
        input.projectId,
        input.idempotencyKey,
        hash,
      )
      if (retry) return retry
      assertEditable(project, input.expectedRevision)
      const previous = await tx.studioProjectRevision.findUniqueOrThrow({
        where: {
          projectId_number: {
            projectId: input.projectId,
            number: project.currentRevision,
          },
        },
      })
      const document = applyOperations(
        studioDocumentSchema.parse(previous.document),
        input.operations,
      )
      const revision = project.currentRevision + 1
      await tx.studioProjectRevision.create({
        data: { projectId: project.id, number: revision, document, actor },
      })
      await tx.studioProject.update({
        where: { id: project.id },
        data: { currentRevision: revision },
      })
      const result = {
        projectId: project.id,
        revision,
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
      return result
    })
  }
  async request(user: Principal | null, raw: unknown) {
    const actor = studioActor(user)
    const input = studioRequestSchema.parse(raw)
    return this.db.$transaction(async (tx) => {
      const project = await lockProject(tx, input.projectId)
      const hash = studioHash({ command: "request", actor, input })
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
      if (input.kind === "NARRATION") {
        const dependencyHash = scriptHash(
          studioDocumentSchema.parse(revision.document),
        )
        const approved = await tx.studioApproval.findFirst({
          where: { projectId: project.id, kind: "SCRIPT", dependencyHash },
        })
        if (!approved) throw new StudioCommandError("APPROVAL_REQUIRED")
      }
      const attempt = await tx.studioAttempt.create({
        data: {
          projectId: project.id,
          baseRevision: project.currentRevision,
          kind: input.kind,
          inputHash: studioHash({
            document: revision.document,
            instructions: input.instructions,
            kind: input.kind,
          }),
          actor,
          instructions: input.instructions,
        },
      })
      const result = {
        projectId: project.id,
        revision: project.currentRevision,
        attemptId: attempt.id,
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
      return result
    })
  }
  async complete(user: Principal | null, raw: unknown) {
    const actor = studioActor(user)
    if (actor.kind !== "service")
      throw new ForbiddenError("Only a trusted worker can complete an attempt")
    const input = studioCompleteSchema.parse(raw)
    return this.db.$transaction(async (tx) => {
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
      let revision = project.currentRevision
      if (!stale && input.status === "SUCCEEDED" && input.operations.length) {
        const previous = await tx.studioProjectRevision.findUniqueOrThrow({
          where: {
            projectId_number: { projectId: project.id, number: revision },
          },
        })
        const document = applyOperations(
          studioDocumentSchema.parse(previous.document),
          input.operations,
        )
        revision += 1
        await tx.studioProjectRevision.create({
          data: { projectId: project.id, number: revision, document, actor },
        })
        await tx.studioProject.update({
          where: { id: project.id },
          data: { currentRevision: revision },
        })
      }
      await tx.studioAttempt.update({
        where: { id: attempt.id },
        data: {
          status: stale ? "STALE" : input.status,
          result: input.result,
          completedBy: actor,
        },
      })
      const result = {
        projectId: project.id,
        revision,
        attemptId: attempt.id,
        outcome: stale ? ("STALE" as const) : ("ACCEPTED" as const),
      }
      await saveReceipt(
        tx,
        project.id,
        input.idempotencyKey,
        hash,
        actor,
        result,
      )
      return result
    })
  }
  async readAttempt(
    user: Principal | null,
    projectId: string,
    attemptId: string,
  ) {
    studioActor(user)
    const row = await this.db.studioAttempt.findFirst({
      where: {
        id: studioIdSchema.parse(attemptId),
        projectId: studioIdSchema.parse(projectId),
      },
    })
    if (!row) throw new NotFoundError("StudioAttempt")
    return studioAttemptSchema.strip().parse(row)
  }
  async approve(user: Principal | null, raw: unknown) {
    const actor = studioActor(user)
    if (actor.kind !== "human")
      throw new ForbiddenError("Human review required")
    const input = studioApproveSchema.parse(raw)
    return this.db.$transaction(async (tx) => {
      const project = await lockProject(tx, input.projectId)
      const hash = studioHash({ command: "approve", actor, input })
      const retry = await receipt(tx, project.id, input.idempotencyKey, hash)
      if (retry) return retry
      assertEditable(project, input.expectedRevision)
      const row = await tx.studioProjectRevision.findUniqueOrThrow({
        where: {
          projectId_number: {
            projectId: project.id,
            number: project.currentRevision,
          },
        },
      })
      const document = studioDocumentSchema.parse(row.document)
      let dependencyHash = scriptHash(document)
      if (input.kind === "SCRIPT" && input.renderAttemptId)
        throw new StudioCommandError("INVALID")
      if (input.kind === "PUBLICATION") {
        if (!input.renderAttemptId)
          throw new StudioCommandError("APPROVAL_REQUIRED")
        dependencyHash = await publicationDependencyHash(
          tx,
          project,
          document,
          input.renderAttemptId,
        )
      }
      const approval = await tx.studioApproval.create({
        data: {
          projectId: project.id,
          revision: project.currentRevision,
          kind: input.kind,
          dependencyHash,
          actor,
          renderAttemptId: input.renderAttemptId,
        },
      })
      const result = {
        projectId: project.id,
        revision: project.currentRevision,
        approvalId: approval.id,
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
      return result
    })
  }
  async unpublish(user: Principal | null, raw: unknown) {
    const actor = studioActor(user)
    if (actor.kind !== "human")
      throw new ForbiddenError("Human authority required")
    const input = studioCommandBaseSchema.parse(raw)
    return this.db.$transaction(async (tx) => {
      const project = await lockProject(tx, input.projectId)
      const hash = studioHash({ command: "unpublish", actor, input })
      const retry = await receipt(tx, project.id, input.idempotencyKey, hash)
      if (retry) return retry
      if (project.currentRevision !== input.expectedRevision)
        throw new StudioCommandError("CONFLICT")
      if (project.lifecycle !== "PUBLISHED" || !project.firstPublishedAt)
        throw new StudioCommandError("IMMUTABLE")
      await tx.studioProject.update({
        where: { id: project.id },
        data: { lifecycle: "UNPUBLISHED", unpublishedAt: new Date() },
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
      return result
    })
  }
  async start(user: Principal | null, raw: unknown) {
    const actor = studioActor(user)
    if (actor.kind !== "service")
      throw new ForbiddenError("Only a trusted worker can start an attempt")
    const input = studioStartSchema.parse(raw)
    return this.db.$transaction(async (tx) => {
      const project = await lockProject(tx, input.projectId)
      const hash = studioHash({ command: "start", actor, input })
      const retry = await receipt(tx, project.id, input.idempotencyKey, hash)
      if (retry) return retry
      assertEditable(project, input.expectedRevision)
      const attempt = await tx.studioAttempt.findUnique({
        where: { id: input.attemptId },
      })
      if (!attempt || attempt.projectId !== project.id)
        throw new NotFoundError("StudioAttempt")
      if (
        attempt.baseRevision !== input.expectedRevision ||
        attempt.status !== "QUEUED"
      )
        throw new StudioCommandError("CONFLICT")
      await tx.studioAttempt.update({
        where: { id: attempt.id },
        data: { status: "RUNNING", jobReference: input.jobReference },
      })
      const result = {
        projectId: project.id,
        revision: project.currentRevision,
        attemptId: attempt.id,
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
      return result
    })
  }
  async list(user: Principal | null, raw: unknown = {}) {
    studioActor(user)
    const input = studioListSchema.parse(raw)
    const rows = await this.db.studioProject.findMany({
      where: input.cursor ? { id: { gt: input.cursor } } : undefined,
      orderBy: { id: "asc" },
      take: input.limit,
      select: { id: true, currentRevision: true, lifecycle: true },
    })
    return rows.map((row) =>
      studioProjectSummarySchema.parse({
        projectId: row.id,
        revision: row.currentRevision,
        lifecycle: row.lifecycle,
      }),
    )
  }
  async history(user: Principal | null, projectId: string, raw: unknown = {}) {
    studioActor(user)
    studioIdSchema.parse(projectId)
    const input = studioHistorySchema.parse(raw)
    const rows = await this.db.studioProjectRevision.findMany({
      where: {
        projectId,
        number: input.beforeRevision ? { lt: input.beforeRevision } : undefined,
      },
      orderBy: { number: "desc" },
      take: input.limit,
    })
    return rows.map((row) =>
      studioRevisionSchema.parse({
        revision: row.number,
        document: row.document,
        actor: row.actor,
      }),
    )
  }
  async attempts(user: Principal | null, projectId: string, raw: unknown = {}) {
    studioActor(user)
    studioIdSchema.parse(projectId)
    const input = studioListSchema.parse(raw)
    const rows = await this.db.studioAttempt.findMany({
      where: { projectId, id: input.cursor ? { gt: input.cursor } : undefined },
      orderBy: { id: "asc" },
      take: input.limit,
    })
    return rows.map((row) => studioAttemptSchema.strip().parse(row))
  }
  async approvals(
    user: Principal | null,
    projectId: string,
    raw: unknown = {},
  ) {
    studioActor(user)
    studioIdSchema.parse(projectId)
    const input = studioListSchema.parse(raw)
    const rows = await this.db.studioApproval.findMany({
      where: { projectId, id: input.cursor ? { gt: input.cursor } : undefined },
      orderBy: { id: "asc" },
      take: input.limit,
    })
    return rows.map((row) => studioApprovalSchema.strip().parse(row))
  }
  async readRevision(
    user: Principal | null,
    projectId: string,
    number: number,
  ) {
    studioActor(user)
    studioIdSchema.parse(projectId)
    const row = await this.db.studioProjectRevision.findUnique({
      where: { projectId_number: { projectId, number } },
    })
    if (!row) throw new NotFoundError("StudioProjectRevision")
    return {
      revision: row.number,
      document: studioDocumentSchema.parse(row.document),
      actor: studioActorSchema.parse(row.actor),
    }
  }
  async read(user: Principal | null, rawId: string) {
    studioActor(user)
    const id = studioIdSchema.parse(rawId)
    const project = await this.db.studioProject.findUnique({ where: { id } })
    if (!project) throw new NotFoundError("StudioProject", id)
    const revision = await this.db.studioProjectRevision.findUniqueOrThrow({
      where: {
        projectId_number: { projectId: id, number: project.currentRevision },
      },
    })
    return studioProjectSchema.parse({
      projectId: id,
      revision: revision.number,
      lifecycle: project.lifecycle,
      firstPublishedAt: project.firstPublishedAt?.toISOString() ?? null,
      document: studioDocumentSchema.parse(revision.document),
      actor: studioActorSchema.parse(revision.actor),
    })
  }
}
