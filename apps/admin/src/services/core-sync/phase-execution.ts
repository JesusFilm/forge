import { randomUUID } from "node:crypto"
import { Prisma, type PrismaClient } from "@prisma/client"
import { Client } from "pg"
import { z } from "zod"
import { env } from "@/config/env"
import type { CoreSyncJobStart } from "./job"
import type { PhaseResult } from "./orchestrator"
import { refreshSyncLock } from "./lock"
import { updateStatsOnly } from "./watermark"
import { PHASE_ORDER, emptySyncStats, type SyncPhase } from "./types"

type StartedJob = Exclude<CoreSyncJobStart, { skipped: true }>
const PHASE_WORKER_LOCK = 426_083_111
const POLL_MS = 5_000
const resultSchema = z.object({
  phase: z.string(),
  created: z.number().int().nonnegative(),
  updated: z.number().int().nonnegative(),
  softDeleted: z.number().int().nonnegative(),
  errors: z.number().int().nonnegative(),
  durationMs: z.number().nonnegative(),
})
const jobSchema = z.object({
  skipped: z.literal(false),
  run: z.object({
    runId: z.string(),
    incremental: z.boolean(),
    phasesToRun: z.array(z.enum(PHASE_ORDER as [SyncPhase, ...SyncPhase[]])),
    startedAtMs: z.number(),
  }),
  scope: z.array(z.enum(PHASE_ORDER as [SyncPhase, ...SyncPhase[]])),
  incremental: z.boolean(),
  trigger: z.enum(["manual", "scheduled", "graphql"]),
  ledgerRunId: z.string().optional(),
})

export function parseCoreSyncPhaseResult(value: unknown): PhaseResult {
  return resultSchema.parse(value)
}

/** A short durable step: enqueue once, then observe the native worker result. */
export async function observeCoreSyncPhase(
  prisma: PrismaClient,
  start: StartedJob,
  phase: SyncPhase,
): Promise<PhaseResult | null> {
  const execution = await prisma.coreSyncPhaseExecution
    .upsert({
      where: { syncRunId_phase: { syncRunId: start.run.runId, phase } },
      create: {
        syncRunId: start.run.runId,
        phase,
        input: JSON.parse(JSON.stringify(start)),
      },
      update: { syncRunId: start.run.runId },
    })
    .catch(async (error) => {
      // Prisma can emulate compound-key upserts; two observers can race on create.
      if (
        !(error instanceof Prisma.PrismaClientKnownRequestError) ||
        error.code !== "P2002"
      )
        throw error
      return prisma.coreSyncPhaseExecution.findUniqueOrThrow({
        where: { syncRunId_phase: { syncRunId: start.run.runId, phase } },
      })
    })
  if (execution.state === "COMPLETE") {
    const result = parseCoreSyncPhaseResult(execution.result)
    if (result.phase !== phase)
      throw new Error("Core phase result identity mismatch")
    return result
  }
  if (execution.state === "FAILED")
    throw new Error(execution.error ?? "Core phase execution failed")
  if (!(await refreshSyncLock(prisma, start.run.runId)))
    throw new Error("Core sync lock lost while awaiting worker")
  return null
}

/** The session lock survives long phases and is released on process death. */
export async function executeNextCoreSyncPhase(
  prisma: PrismaClient,
  databaseUrl = env.DATABASE_URL,
): Promise<boolean> {
  const lock = new Client({
    connectionString: databaseUrl,
    connectionTimeoutMillis: 5_000,
  })
  const abort = new AbortController()
  lock.on("error", () =>
    abort.abort(new Error("Core phase worker session lost")),
  )
  await lock.connect()
  try {
    const claim = await lock.query<{ locked: boolean }>(
      "SELECT pg_try_advisory_lock($1) AS locked",
      [PHASE_WORKER_LOCK],
    )
    if (!claim.rows[0]?.locked) return false
    const row = await prisma.coreSyncPhaseExecution.findFirst({
      where: { state: { in: ["PENDING", "RUNNING"] } },
      orderBy: { createdAt: "asc" },
    })
    if (!row) return false
    const token = randomUUID()
    await prisma.coreSyncPhaseExecution.update({
      where: { id: row.id },
      data: { state: "RUNNING", claimToken: token, attempts: { increment: 1 } },
    })
    try {
      if (row.attempts >= 3)
        throw new Error("Core phase exceeded restart recovery limit")
      const start = jobSchema.parse(row.input)
      const phase = z
        .enum(PHASE_ORDER as [SyncPhase, ...SyncPhase[]])
        .parse(row.phase)
      if (start.run.runId !== row.syncRunId || !start.scope.includes(phase))
        throw new Error("Core phase execution identity mismatch")
      if (start.ledgerRunId) {
        const ledger = await prisma.workflowRun.findUnique({
          where: { id: start.ledgerRunId },
          select: { status: true },
        })
        if (!ledger || !["QUEUED", "RUNNING"].includes(ledger.status))
          throw new Error("Core sync is no longer active")
      }
      // An extension preserves the Prisma API while refusing new queries after
      // the exclusive worker session is lost, including inside transactions.
      const guarded = prisma.$extends({
        query: {
          $allOperations({ args, query }) {
            abort.signal.throwIfAborted()
            return query(args)
          },
        },
      }) as unknown as PrismaClient
      const { runCoreSyncPhaseJob } = await import("./job")
      const result = await runCoreSyncPhaseJob(start, phase, guarded)
      abort.signal.throwIfAborted()
      await prisma.coreSyncPhaseExecution.updateMany({
        where: { id: row.id, claimToken: token },
        data: {
          state: "COMPLETE",
          result: result as Prisma.InputJsonValue,
          error: null,
        },
      })
    } catch (error) {
      if (abort.signal.aborted) throw error // Leave RUNNING for the next session.
      // The body may have committed partial rows before crashing. Block catalog
      // publication until a later successful run repairs this phase.
      const failedPhase = z
        .enum(PHASE_ORDER as [SyncPhase, ...SyncPhase[]])
        .safeParse(row.phase)
      if (failedPhase.success)
        await updateStatsOnly(prisma, failedPhase.data, {
          ...emptySyncStats,
          errors: 1,
        })
      await prisma.coreSyncPhaseExecution.updateMany({
        where: { id: row.id, claimToken: token },
        data: {
          state: "FAILED",
          error:
            error instanceof Error
              ? error.message.slice(0, 1000)
              : "Core phase failed",
        },
      })
    }
    return true
  } finally {
    await lock.end()
  }
}

type WorkerGlobal = typeof globalThis & { __coreSyncPhaseWorker?: boolean }

export function ensureCoreSyncPhaseWorkerStarted(prisma: PrismaClient): void {
  const state = globalThis as WorkerGlobal
  if (state.__coreSyncPhaseWorker) return
  state.__coreSyncPhaseWorker = true
  const tick = async () => {
    try {
      await executeNextCoreSyncPhase(prisma)
    } catch (error) {
      console.error(
        JSON.stringify({
          event: "core-sync.phase-worker.failed",
          error: error instanceof Error ? error.name : "UnknownError",
        }),
      )
    }
    const timer = setTimeout(() => {
      void tick()
    }, POLL_MS)
    timer.unref?.()
  }
  void tick()
}
