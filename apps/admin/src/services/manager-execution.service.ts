import { randomUUID } from "node:crypto"
import { Prisma, type PrismaClient } from "@prisma/client"
import { z } from "zod"
import type { Principal } from "@/auth/principal"
import { hasPermission } from "@/auth/permissions"
import { ForbiddenError } from "./errors"

const digest = z
  .string()
  .regex(/^[a-f0-9]{64}$/i)
  .transform((s) => s.toLowerCase())
const claimSchema = z
  .object({
    jobId: z.string().min(1).max(256),
    runId: z.string().min(1).max(256),
    inputDigest: digest,
    operationId: z.enum([
      "run-admission",
      "audio-cleanup",
      "apply-transcript-corrections",
      "mux-publication",
      "mastra:source",
      "mastra:correction",
      "mastra:translation",
      "mastra:chapters",
      "mastra:metadata",
      "mastra:embeddings",
      "mastra:scene-analysis",
    ]),
    operationDigest: digest,
  })
  .strict()
const completeSchema = claimSchema
  .extend({ claimToken: z.uuid(), result: z.unknown() })
  .strict()

export type ManagerExecutionResult = {
  status: "claimed" | "replayed" | "conflict" | "stale"
  claimToken?: string
  result?: unknown
}

type LockedJob = {
  revision: number
  options: unknown
  status: string
  completedAt: Date | null
}

// Only the authenticated Manager service may spend or publish through this seam.
// ADMIN/SYSTEM permission overrides do not confer this service authority.
export function assertManagerExecutionAccess(user: Principal | null) {
  if (
    user?.role !== "MANAGER_BACKEND" ||
    !hasPermission(user, "write:manager-jobs")
  ) {
    throw new ForbiddenError()
  }
}

export function managerExecutionOwner(options: unknown): {
  engine?: unknown
  currentRunId?: unknown
} {
  return options !== null &&
    typeof options === "object" &&
    !Array.isArray(options)
    ? options
    : {}
}

// Shared by job updates, claims, and completions. The caller must retain the
// interactive transaction until all checks and writes have finished.
export async function lockManagerExecutionJob(
  tx: Prisma.TransactionClient,
  id: string,
): Promise<LockedJob | undefined> {
  const rows = await tx.$queryRaw<LockedJob[]>`
    SELECT revision, options, status, completed_at AS "completedAt"
    FROM manager_enrichment_job WHERE id = ${id} FOR UPDATE
  `
  return rows[0]
}

function isCurrent(job: LockedJob | undefined, runId: string): boolean {
  if (!job) return false
  const owner = managerExecutionOwner(job.options)
  return (
    owner.engine === "mastra" &&
    owner.currentRunId === runId &&
    (job.status === "pending" || job.status === "running") &&
    job.completedAt === null
  )
}

export class ManagerExecutionResultError extends Error {
  constructor() {
    super(
      "Manager execution result must be JSON within 32768 bytes, 8192-character strings, 256-character keys, 4096 nodes and 12 nesting levels",
    )
    this.name = "ManagerExecutionResultError"
  }
}

function boundedResult(
  value: unknown,
): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  // Check shape before serialization: depth/width limits bound recursive work,
  // cycles, undefined/NaN, and objects with custom serialization are rejected.
  const pending = [{ value, depth: 0 }]
  let nodes = 0
  while (pending.length) {
    const entry = pending.pop()!
    const v = entry.value
    if (++nodes > 4096 || entry.depth > 12)
      throw new ManagerExecutionResultError()
    if (v === null || typeof v === "boolean") continue
    if (typeof v === "string" && v.length <= 8192) continue
    if (typeof v === "number" && Number.isFinite(v)) continue
    if (typeof v !== "object" || v === null)
      throw new ManagerExecutionResultError()
    if (
      !Array.isArray(v) &&
      Object.getPrototypeOf(v) !== Object.prototype &&
      Object.getPrototypeOf(v) !== null
    )
      throw new ManagerExecutionResultError()
    if (Array.isArray(v) && v.length > 4096)
      throw new ManagerExecutionResultError()
    const entries = Object.entries(v)
    if (Array.isArray(v) && entries.length !== v.length)
      throw new ManagerExecutionResultError()
    if (pending.length + nodes + entries.length > 4096)
      throw new ManagerExecutionResultError()
    for (const [key, child] of entries) {
      if (key.length > 256) throw new ManagerExecutionResultError()
      pending.push({ value: child, depth: entry.depth + 1 })
    }
  }
  const serialized = JSON.stringify(value)
  if (Buffer.byteLength(serialized, "utf8") > 32768)
    throw new ManagerExecutionResultError()
  return value === null
    ? Prisma.JsonNull
    : (JSON.parse(serialized) as Prisma.InputJsonValue)
}

export class ManagerExecutionService {
  constructor(private prisma: PrismaClient) {}

  async claim({
    user,
    input,
  }: {
    user: Principal | null
    input: unknown
  }): Promise<ManagerExecutionResult> {
    assertManagerExecutionAccess(user)
    const parsed = claimSchema.parse(input)
    return this.prisma.$transaction(async (tx) => {
      const job = await lockManagerExecutionJob(tx, parsed.jobId)
      if (!isCurrent(job, parsed.runId)) return { status: "stale" }
      const { jobId, runId, operationId, operationDigest, inputDigest } = parsed
      const run = await tx.managerExecutionRun.findUnique({
        where: { jobId_runId: { jobId, runId } },
      })
      if (run && run.inputDigest !== inputDigest) return { status: "conflict" }
      if (!run)
        await tx.managerExecutionRun.create({
          data: { jobId, runId, inputDigest },
        })
      const existing = await tx.managerExecutionOperation.findUnique({
        where: { jobId_runId_operationId: { jobId, runId, operationId } },
      })
      if (existing) {
        if (
          existing.operationDigest !== operationDigest ||
          !existing.completedAt
        )
          return { status: "conflict" }
        return { status: "replayed", result: existing.result }
      }
      const claimToken = randomUUID()
      await tx.managerExecutionOperation.create({
        data: { jobId, runId, operationId, operationDigest, claimToken },
      })
      return { status: "claimed", claimToken }
    })
  }

  async complete({
    user,
    input,
  }: {
    user: Principal | null
    input: unknown
  }): Promise<ManagerExecutionResult> {
    assertManagerExecutionAccess(user)
    const parsed = completeSchema.parse(input)
    const result = boundedResult(parsed.result)
    return this.prisma.$transaction(async (tx) => {
      const job = await lockManagerExecutionJob(tx, parsed.jobId)
      if (!isCurrent(job, parsed.runId)) return { status: "stale" }
      const { jobId, runId, operationId } = parsed
      const run = await tx.managerExecutionRun.findUnique({
        where: { jobId_runId: { jobId, runId } },
      })
      const operation = await tx.managerExecutionOperation.findUnique({
        where: { jobId_runId_operationId: { jobId, runId, operationId } },
      })
      if (
        !run ||
        run.inputDigest !== parsed.inputDigest ||
        !operation ||
        operation.operationDigest !== parsed.operationDigest ||
        operation.claimToken !== parsed.claimToken
      )
        return { status: "conflict" }
      if (operation.completedAt)
        return { status: "replayed", result: operation.result }
      const completed = await tx.managerExecutionOperation.update({
        where: { jobId_runId_operationId: { jobId, runId, operationId } },
        data: { result, completedAt: new Date() },
      })
      return { status: "replayed", result: completed.result }
    })
  }
}
