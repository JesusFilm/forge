import { assertStudioProductionEnabled } from "./release-controls"
import { studioProductionListSchema } from "@forge/studio-contracts/production"
import { z } from "zod"
import type { PrismaClient } from "@prisma/client"
import type { Principal } from "@/auth/principal"
import { canReviewStudio } from "@/auth/permissions"
import { ForbiddenError, NotFoundError } from "../errors"
import {
  studioActor,
  studioHash,
  lockProject,
  scriptHash,
  assertEditable,
} from "./state"
import {
  studioAssetReferenceSchema,
  studioAttemptResultSchema,
  studioDigestSchema,
  studioDocumentSchema,
  studioIdSchema,
} from "@forge/studio-contracts"
import { StudioCommandError } from "./errors"
const money = z.number().int().nonnegative().max(100000000)
const admission = z
  .object({
    attemptId: studioIdSchema.optional(),
    experimentId: studioIdSchema.optional(),
    maxCostMicros: money,
  })
  .strict()
  .refine((v) => Boolean(v.attemptId) !== Boolean(v.experimentId))
const claimSchema = z
  .object({
    runId: studioIdSchema,
    key: studioIdSchema,
    inputDigest: studioDigestSchema,
    reserveMicros: money,
  })
  .strict()
const outputSchema = z
  .object({
    assets: z.array(studioAssetReferenceSchema).max(64),
    actualCostMicros: z
      .number()
      .int()
      .nonnegative()
      .max(Number.MAX_SAFE_INTEGER)
      .nullable(),
    credits: z.number().nonnegative().nullable(),
    requestId: z.string().max(128).nullable(),
    elapsedMs: z.number().nonnegative(),
    diagnostic: z.string().max(2000).optional(),
    providerMetadata: z
      .record(z.string().max(128), z.json())
      .refine((v) => Buffer.byteLength(JSON.stringify(v)) <= 16384)
      .optional(),
  })
  .strict()
export class StudioExecutionError extends Error {
  constructor(
    public readonly code: "BUDGET_EXCEEDED" | "CANCELLED" | "CONFLICT",
  ) {
    super(code)
  }
}
/** Paid calls are consumed before dispatch, including an ambiguous RUNNING claim after a crash. */
export class StudioExecutionService {
  constructor(private readonly db: PrismaClient) {}
  async admit(user: Principal | null, raw: unknown) {
    if (!canReviewStudio(user))
      throw new ForbiddenError("Interactive paid production request required")
    const actor = studioActor(user),
      input = admission.parse(raw)
    return this.db.$transaction(async (tx) => {
      const key = input.attemptId ?? input.experimentId!
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key},458))::text`
      const prior = await tx.shortProductionRun.findFirst({
        where: input.attemptId
          ? { attemptId: input.attemptId }
          : { experimentId: input.experimentId },
      })
      if (prior) {
        if (
          studioHash(prior.actor) !== studioHash(actor) ||
          Number(prior.maxCostMicros) !== input.maxCostMicros
        )
          throw new StudioExecutionError("CONFLICT")
        return { ...prior, maxCostMicros: Number(prior.maxCostMicros) }
      }
      assertStudioProductionEnabled()
      if (input.attemptId) {
        const attempt = await tx.shortAttempt.findUniqueOrThrow({
          where: { id: input.attemptId },
        })
        if (
          attempt.kind !== "NARRATION" ||
          !["QUEUED", "RUNNING"].includes(attempt.status)
        )
          throw new StudioCommandError("INVALID")
        const project = await lockProject(tx, attempt.projectId)
        assertEditable(project, attempt.baseRevision)
        const revision = await tx.shortRevision.findUniqueOrThrow({
          where: {
            projectId_number: {
              projectId: project.id,
              number: attempt.baseRevision,
            },
          },
        })
        if (
          !(await tx.shortApproval.findFirst({
            where: {
              projectId: project.id,
              kind: "SCRIPT",
              dependencyHash: scriptHash(
                studioDocumentSchema.parse(revision.document),
              ),
            },
          }))
        )
          throw new StudioCommandError("APPROVAL_REQUIRED")
      } else {
        const experiment = await tx.shortExperiment.findUniqueOrThrow({
          where: { id: input.experimentId },
        })
        const request = z
          .object({ maxCostMicros: money })
          .parse(experiment.request)
        if (
          studioHash(experiment.actor) !== studioHash(actor) ||
          request.maxCostMicros !== input.maxCostMicros
        )
          throw new ForbiddenError()
      }
      const row = await tx.shortProductionRun.create({
        data: { ...input, actor, maxCostMicros: BigInt(input.maxCostMicros) },
      })
      return { ...row, maxCostMicros: Number(row.maxCostMicros) }
    })
  }
  async claim(user: Principal | null, raw: unknown) {
    if (studioActor(user).kind !== "service")
      throw new ForbiddenError("Trusted execution required")
    const input = claimSchema.parse(raw)
    return this.db.$transaction(async (tx) => {
      const context = await tx.shortProductionRun.findUniqueOrThrow({
        where: { id: input.runId },
      })
      const attempt = context.attemptId
        ? await tx.shortAttempt.findUniqueOrThrow({
            where: { id: context.attemptId },
            select: { id: true, projectId: true, baseRevision: true },
          })
        : null
      const project = attempt ? await lockProject(tx, attempt.projectId) : null
      await tx.$queryRaw`SELECT id FROM short_production_run WHERE id=${input.runId} FOR UPDATE`
      const run = await tx.shortProductionRun.findUniqueOrThrow({
        where: { id: input.runId },
        include: { calls: true },
      })
      const prior = run.calls.find((c) => c.key === input.key)
      if (prior) {
        if (
          prior.inputDigest !== input.inputDigest ||
          Number(prior.reserveMicros) !== input.reserveMicros
        )
          throw new StudioExecutionError("CONFLICT")
        return {
          execute: false,
          call: { ...prior, reserveMicros: Number(prior.reserveMicros) },
        }
      }
      assertStudioProductionEnabled()
      if (attempt && project) {
        assertEditable(project, attempt.baseRevision)
        const currentAttempt = await tx.shortAttempt.findUniqueOrThrow({
          where: { id: attempt.id },
        })
        if (!["QUEUED", "RUNNING"].includes(currentAttempt.status))
          throw new StudioExecutionError("CONFLICT")
      }
      if (run.state !== "READY") throw new StudioExecutionError("CANCELLED")
      const reserved = run.calls.reduce((n, c) => n + c.reserveMicros, 0n)
      if (
        reserved + BigInt(input.reserveMicros) > run.maxCostMicros ||
        run.calls.length >= 1000
      )
        throw new StudioExecutionError("BUDGET_EXCEEDED")
      const call = await tx.shortProductionCall.create({
        data: { ...input, reserveMicros: BigInt(input.reserveMicros) },
      })
      return {
        execute: true,
        call: { ...call, reserveMicros: Number(call.reserveMicros) },
      }
    })
  }
  async finish(user: Principal | null, raw: unknown) {
    if (studioActor(user).kind !== "service") throw new ForbiddenError()
    const input = z
      .object({
        runId: studioIdSchema,
        key: studioIdSchema,
        state: z.enum(["COMPLETED", "FAILED", "AMBIGUOUS"]),
        result: outputSchema,
      })
      .strict()
      .parse(raw)
    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM short_production_run WHERE id=${input.runId} FOR UPDATE`
      const call = await tx.shortProductionCall.findUniqueOrThrow({
        where: { runId_key: { runId: input.runId, key: input.key } },
      })
      if (call.state !== "RUNNING") {
        if (
          call.state !== input.state ||
          studioHash(call.result) !== studioHash(input.result)
        )
          throw new StudioExecutionError("CONFLICT")
      } else
        await tx.shortProductionCall.update({
          where: { runId_key: { runId: input.runId, key: input.key } },
          data: { state: input.state, result: input.result },
        })
      return { recorded: true }
    })
  }
  async list(user: Principal | null, raw: unknown) {
    studioActor(user)
    const input = studioProductionListSchema.parse(raw)
    const runs = await this.db.shortProductionRun.findMany({
      where: {
        ...(input.projectId ? { attempt: { projectId: input.projectId } } : {}),
        ...(input.kind === "experiment"
          ? { experimentId: { not: null } }
          : input.kind === "narration"
            ? { attemptId: { not: null } }
            : {}),
        ...(input.before
          ? {
              OR: [
                { createdAt: { lt: new Date(input.before.createdAt) } },
                {
                  createdAt: new Date(input.before.createdAt),
                  id: { lt: input.before.id },
                },
              ],
            }
          : {}),
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 20,
      select: {
        id: true,
        state: true,
        createdAt: true,
        attemptId: true,
        experimentId: true,
        experiment: { select: { request: true } },
      },
    })
    return runs.map(({ experiment, ...run }) => {
      const request = experiment
        ? z
            .object({ kind: z.enum(["music", "voice"]), prompt: z.string() })
            .parse(experiment.request)
        : null
      return {
        ...run,
        label: request
          ? `${request.kind === "music" ? "Music" : "Voice design"} · ${request.prompt.slice(0, 100)}${request.prompt.length > 100 ? "…" : ""}`
          : "Narration",
      }
    })
  }
  async read(user: Principal | null, id: string, after?: string) {
    studioActor(user)
    const run = await this.db.shortProductionRun.findUnique({
      where: { id: studioIdSchema.parse(id) },
      include: {
        attempt: {
          select: {
            status: true,
            result: true,
            projectId: true,
            baseRevision: true,
          },
        },
        calls: {
          where: after
            ? { key: { gt: studioIdSchema.parse(after) } }
            : undefined,
          orderBy: { key: "asc" },
          take: 21,
        },
      },
    })
    if (!run) throw new NotFoundError("Studio production")
    let timingConflicts: string[] = []
    if (run.attempt?.result) {
      const indices = studioAttemptResultSchema.parse(
        run.attempt.result,
      ).timingConflictIndices
      if (indices?.length) {
        const revision = await this.db.shortRevision.findUniqueOrThrow({
          where: {
            projectId_number: {
              projectId: run.attempt.projectId,
              number: run.attempt.baseRevision,
            },
          },
        })
        const document = studioDocumentSchema.parse(revision.document)
        timingConflicts = indices.map((index) => document.items[index].id)
      }
    }
    return {
      ...run,
      timingConflicts,
      maxCostMicros: Number(run.maxCostMicros),
      nextKey: run.calls.length > 20 ? run.calls[19].key : null,
      calls: run.calls
        .slice(0, 20)
        .map((c) => ({ ...c, reserveMicros: Number(c.reserveMicros) })),
    }
  }
  async cancel(user: Principal | null, id: string) {
    if (!canReviewStudio(user)) throw new ForbiddenError()
    await this.db.shortProductionRun.updateMany({
      where: { id: studioIdSchema.parse(id), state: "READY" },
      data: { state: "CANCELLED" },
    })
    return this.read(user, id)
  }
}
