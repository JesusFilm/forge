import {
  assertStudioProductionEnabled,
  studioProductionEnabled,
} from "./release-controls"
import {
  STUDIO_RENDER_PROFILE,
  studioRenderAssignmentSchema as assignmentSchema,
} from "@forge/studio-contracts/render"
import { z } from "zod"
import { completeStudioAttempt } from "./completion"
import { randomUUID } from "node:crypto"
import type { Prisma, PrismaClient } from "@prisma/client"
import {
  studioIdSchema,
  studioCommandBaseSchema,
  studioDocumentSchema,
  studioAttemptResultSchema,
} from "@forge/studio-contracts"
import type { Principal } from "@/auth/principal"
import { ForbiddenError, NotFoundError } from "../errors"
import {
  studioActor,
  lockProject,
  studioHash,
  assertEditable,
  receipt,
  saveReceipt,
} from "./state"
import { StudioCommandError } from "./errors"

function requireWorker(user: Principal | null) {
  if (studioActor(user).kind !== "service")
    throw new ForbiddenError("Trusted render worker required")
}
type RenderAssignment = z.infer<typeof assignmentSchema>
async function lockRenderAttempt(
  tx: Prisma.TransactionClient,
  attemptId: string,
) {
  const identity = await tx.studioAttempt.findUniqueOrThrow({
    where: { id: attemptId },
    select: { projectId: true },
  })
  const project = await lockProject(tx, identity.projectId)
  // Under READ COMMITTED another writer may terminalize this attempt while
  // we wait. Only the immutable identity may be used from before the lock.
  const attempt = await tx.studioAttempt.findUniqueOrThrow({
    where: { id: attemptId },
  })
  return { project, attempt }
}
/** Canonical attempts precede queueing. Reconciliation can recover an admitted
 * QUEUED render whose broker crashed before enqueue; it never invents admission. */
export class StudioRenderJobs {
  constructor(private readonly db: PrismaClient) {}
  /** Bounded restart scan includes the admission/enqueue crash window. Every
   * candidate must still pass claim under its project lock before dispatch. */
  async pending(user: Principal | null, now = new Date()) {
    requireWorker(user)
    const rows = await this.db.studioAttempt.findMany({
      where: {
        kind: "RENDER",
        status: { in: ["QUEUED", "RUNNING"] },
        OR: [
          { renderJob: null },
          { renderJob: { state: "QUEUED" } },
          { renderJob: { state: "RUNNING", leaseExpiresAt: { lte: now } } },
        ],
      },
      select: { id: true },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: 100,
    })
    return rows.map((row) => row.id)
  }
  async cancel(user: Principal | null, raw: unknown) {
    const actor = studioActor(user)
    const input = studioCommandBaseSchema
      .extend({ attemptId: studioIdSchema })
      .strict()
      .parse(raw)
    const hash = studioHash({ command: "cancel-render", actor, input })
    return this.db.$transaction(async (tx) => {
      const project = await lockProject(tx, input.projectId)
      const retry = await receipt(tx, project.id, input.idempotencyKey, hash)
      if (retry) return retry
      assertEditable(project, input.expectedRevision)
      const attempt = await tx.studioAttempt.findUnique({
        where: { id: input.attemptId },
      })
      if (
        !attempt ||
        attempt.projectId !== project.id ||
        attempt.kind !== "RENDER"
      )
        throw new NotFoundError("StudioAttempt")
      if (!["QUEUED", "RUNNING"].includes(attempt.status))
        throw new StudioCommandError("CONFLICT")
      await tx.$queryRaw`SELECT attempt_id FROM studio_render_job WHERE attempt_id=${attempt.id} FOR UPDATE`
      const job = await tx.studioRenderJob.findUnique({
        where: { attemptId: attempt.id },
      })
      await tx.studioAttempt.update({
        where: { id: attempt.id },
        data: {
          status: "CANCELLED",
          completedBy: actor,
          result: {
            assets: [],
            costMicros: null,
            diagnostic: "Render cancelled",
          },
        },
      })
      if (job && ["QUEUED", "RUNNING"].includes(job.state))
        await tx.studioRenderJob.update({
          where: { attemptId: attempt.id },
          data: { state: "CANCELLED" },
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
  async enqueue(user: Principal | null, rawId: string) {
    requireWorker(user)
    const attemptId = studioIdSchema.parse(rawId)
    return this.db.$transaction(async (tx) => {
      const { attempt } = await lockRenderAttempt(tx, attemptId)
      const existing = await tx.studioRenderJob.findUnique({
        where: { attemptId },
      })
      if (existing) return existing
      if (
        attempt.kind !== "RENDER" ||
        !["QUEUED", "RUNNING"].includes(attempt.status)
      )
        throw new StudioCommandError("INVALID")
      const revision = await tx.studioProjectRevision.findUniqueOrThrow({
        where: {
          projectId_number: {
            projectId: attempt.projectId,
            number: attempt.baseRevision,
          },
        },
      })
      const document = studioDocumentSchema.parse(revision.document)
      return tx.studioRenderJob.create({
        data: {
          attemptId,
          snapshot: {
            projectId: attempt.projectId,
            revision: attempt.baseRevision,
            inputHash: attempt.inputHash,
            executionProfile: STUDIO_RENDER_PROFILE,
            document,
          },
        },
      })
    })
  }
  async read(user: Principal | null, rawId: string) {
    requireWorker(user)
    const job = await this.db.studioRenderJob.findUnique({
      where: { attemptId: studioIdSchema.parse(rawId) },
      include: {
        executions: { orderBy: { createdAt: "asc" } },
        leases: {
          orderBy: { generation: "asc" },
          include: { retainedAssets: { include: { assetVersion: true } } },
        },
      },
    })
    if (!job) throw new NotFoundError("StudioRenderJob")
    return job
  }
  async claim(
    user: Principal | null,
    rawId: string,
    leaseMs: number = STUDIO_RENDER_PROFILE.leaseMs,
    now?: Date,
  ) {
    return this.claimIssued(user, rawId, leaseMs, now)
  }
  /** Internal broker seam. The outbound gateway authenticates pool/worker; a VM
   * token never becomes a Principal or receives this generic service interface.
   * Dispatch UUID must be durable before the first network request. */
  async claimAssigned(
    user: Principal | null,
    rawId: string,
    rawAssignment: unknown,
    leaseMs: number = STUDIO_RENDER_PROFILE.leaseMs,
  ) {
    return this.claimIssued(
      user,
      rawId,
      leaseMs,
      undefined,
      assignmentSchema.parse(rawAssignment),
    )
  }
  /** Immutable receipt lookup only. The broker must still call claimAssigned
   * for current eligibility; this read neither assigns nor authorizes work. */
  async assigned(user: Principal | null, rawAssignment: unknown) {
    requireWorker(user)
    const assignment = assignmentSchema.parse(rawAssignment)
    const issued = await this.db.studioRenderLease.findUnique({
      where: { dispatchId: assignment.dispatchId },
      select: {
        attemptId: true,
        leaseId: true,
        poolId: true,
        workerId: true,
        dispatchId: true,
        expiresAt: true,
      },
    })
    if (
      issued &&
      (issued.poolId !== assignment.poolId ||
        issued.workerId !== assignment.workerId)
    )
      throw new StudioCommandError("CONFLICT")
    return issued
  }
  private async claimIssued(
    user: Principal | null,
    rawId: string,
    leaseMs: number,
    clock?: Date,
    assignment?: RenderAssignment,
  ) {
    requireWorker(user)
    const attemptId = studioIdSchema.parse(rawId)
    if (!Number.isInteger(leaseMs) || leaseMs < 1000 || leaseMs > 3600000)
      throw new StudioCommandError("INVALID")
    return this.db.$transaction(async (tx) => {
      // All assigned claims take dispatch, then worker, then project/job locks.
      // UUID scope is global: changing pool/worker cannot reuse an issued dispatch.
      if (assignment) {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`studio-render-dispatch:${assignment.dispatchId}`},0))`
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`studio-render-worker:${JSON.stringify([assignment.poolId, assignment.workerId])}`},0))`
      }
      const issued = assignment
        ? await tx.studioRenderLease.findUnique({
            where: { dispatchId: assignment.dispatchId },
          })
        : null
      if (
        issued &&
        (issued.poolId !== assignment?.poolId ||
          issued.workerId !== assignment?.workerId ||
          issued.attemptId !== attemptId)
      )
        throw new StudioCommandError("CONFLICT")
      const { project, attempt } = await lockRenderAttempt(tx, attemptId)
      await tx.$queryRaw`SELECT attempt_id FROM studio_render_job WHERE attempt_id=${attemptId} FOR UPDATE`
      const job = await tx.studioRenderJob.findUniqueOrThrow({
        where: { attemptId },
      })
      const now = clock ?? new Date()
      if (issued) {
        return {
          execute:
            studioProductionEnabled() &&
            issued.leaseId === job.leaseId &&
            issued.expiresAt > now &&
            job.state === "RUNNING" &&
            attempt.status === "RUNNING" &&
            !project.firstPublishedAt &&
            project.currentRevision === attempt.baseRevision,
          leaseId: issued.leaseId,
          expiresAt: issued.expiresAt.getTime(),
        }
      }
      if (
        !["QUEUED", "RUNNING"].includes(job.state) ||
        !["QUEUED", "RUNNING"].includes(attempt.status)
      )
        return { execute: false, leaseId: null }
      if (
        job.state === "RUNNING" &&
        job.leaseExpiresAt &&
        job.leaseExpiresAt > now
      )
        return { execute: false, leaseId: null }
      assertStudioProductionEnabled()
      if (assignment) {
        const active = await tx.$queryRaw<{ attempt_id: string }[]>`
          SELECT l.attempt_id FROM studio_render_lease l
          JOIN studio_render_job j ON j.attempt_id=l.attempt_id AND j.lease_id=l.lease_id
          JOIN studio_attempt a ON a.id=l.attempt_id
          WHERE l.pool_id=${assignment.poolId} AND l.worker_id=${assignment.workerId}
            AND l.expires_at>(${now}::timestamptz AT TIME ZONE 'UTC')
            AND j.state='RUNNING' AND a.status='RUNNING'
          LIMIT 1`
        if (active.length) return { execute: false, leaseId: null }
      }
      if (
        project.firstPublishedAt ||
        project.currentRevision !== attempt.baseRevision ||
        job.generation >= 3
      ) {
        await completeStudioAttempt(
          tx,
          user,
          {
            projectId: project.id,
            expectedRevision: attempt.baseRevision,
            idempotencyKey: `render-abandoned:${attempt.id}`,
            attemptId: attempt.id,
            status: "FAILED",
            result: {
              assets: [],
              costMicros: null,
              diagnostic:
                job.generation >= 3
                  ? "Render lease retry budget exhausted"
                  : "Render revision is no longer current",
            },
            operations: [],
          },
          { abandon: true },
        )
        await tx.studioRenderJob.update({
          where: { attemptId },
          data: { state: "FAILED" },
        })
        return { execute: false, leaseId: null }
      }
      const leaseId = randomUUID()
      await tx.studioRenderLease.create({
        data: {
          attemptId,
          leaseId,
          generation: job.generation + 1,
          expiresAt: new Date(now.getTime() + leaseMs),
          ...assignment,
        },
      })
      await tx.studioRenderJob.update({
        where: { attemptId },
        data: {
          state: "RUNNING",
          generation: { increment: 1 },
          leaseId,
          leaseExpiresAt: new Date(now.getTime() + leaseMs),
        },
      })
      await tx.studioAttempt.update({
        where: { id: attempt.id },
        data: {
          status: "RUNNING",
          jobReference: attempt.jobReference ?? `studio-render:${attempt.id}`,
        },
      })
      return { execute: true, leaseId, expiresAt: now.getTime() + leaseMs }
    })
  }
  async finish(user: Principal | null, raw: unknown, now?: Date) {
    requireWorker(user)
    const input = z
      .object({
        attemptId: studioIdSchema,
        leaseId: z.uuid(),
        status: z.enum(["SUCCEEDED", "FAILED", "CANCELLED"]),
        result: studioAttemptResultSchema,
      })
      .strict()
      .parse(raw)
    const requestHash = studioHash(input)
    return this.db.$transaction(async (tx) => {
      const { attempt } = await lockRenderAttempt(tx, input.attemptId)
      await tx.$queryRaw`SELECT attempt_id FROM studio_render_job WHERE attempt_id=${attempt.id} FOR UPDATE`
      const prior = await tx.studioRenderExecution.findUnique({
        where: {
          attemptId_leaseId: { attemptId: attempt.id, leaseId: input.leaseId },
        },
      })
      if (prior) {
        if (prior.requestHash !== requestHash)
          throw new StudioCommandError("CONFLICT")
        return { admitted: prior.admitted }
      }
      const issued = await tx.studioRenderLease.findUnique({
        where: {
          attemptId_leaseId: { attemptId: attempt.id, leaseId: input.leaseId },
        },
      })
      if (!issued) throw new StudioCommandError("INVALID")
      const job = await tx.studioRenderJob.findUniqueOrThrow({
        where: { attemptId: attempt.id },
      })
      const admitted =
        job.state === "RUNNING" &&
        job.leaseId === input.leaseId &&
        !!job.leaseExpiresAt &&
        job.leaseExpiresAt > (now ?? new Date()) &&
        ["QUEUED", "RUNNING"].includes(attempt.status)
      // Losing/late output is retained independently. It cannot overwrite the
      // winning attempt, attach to a newer revision, or resurrect a terminal job.
      await tx.studioRenderExecution.create({
        data: { ...input, requestHash, admitted },
      })
      if (admitted) {
        await completeStudioAttempt(
          tx,
          user,
          {
            projectId: attempt.projectId,
            expectedRevision: attempt.baseRevision,
            idempotencyKey: `render-finish:${input.leaseId}`,
            attemptId: attempt.id,
            status: input.status,
            result: input.result,
            operations: [],
          },
          { leaseId: input.leaseId },
        )
        await tx.studioRenderJob.update({
          where: { attemptId: attempt.id },
          data: { state: "COMPLETED" },
        })
      }
      return { admitted }
    })
  }
  async owns(
    user: Principal | null,
    rawId: string,
    leaseId: string,
    now?: Date,
  ) {
    const job = await this.read(user, rawId)
    return (
      job.state === "RUNNING" &&
      job.leaseId === leaseId &&
      !!job.leaseExpiresAt &&
      job.leaseExpiresAt > (now ?? new Date())
    )
  }
}
