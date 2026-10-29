import { start } from "workflow/api"
import { getWorld } from "workflow/runtime"
import type { World } from "@workflow/world"
import type { PrismaClient } from "@prisma/client"
import { env } from "@/config/env"
import { prisma } from "@/db/client"
import { MANAGER_BACKEND_PRINCIPAL } from "@/auth/principal"
import { ManagerAutomationService } from "./manager-automation.service"
import { runManagerAutomationScheduler } from "@/workflows/managerAutomation"

export class ManagerAutomationSchedulerError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ManagerAutomationSchedulerError"
  }
}
async function readResult(response: Response): Promise<unknown> {
  if (!response.ok) {
    await response.body?.cancel()
    throw new ManagerAutomationSchedulerError(
      `Manager dispatch returned HTTP ${response.status}`,
    )
  }
  if (!response.headers.get("content-type")?.includes("application/json")) {
    await response.body?.cancel()
    throw new ManagerAutomationSchedulerError(
      "Manager dispatch returned a non-JSON response",
    )
  }
  const reader = response.body?.getReader()
  if (!reader)
    throw new ManagerAutomationSchedulerError(
      "Manager dispatch returned no body",
    )
  const chunks: Uint8Array[] = []
  let bytes = 0
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      bytes += chunk.value.byteLength
      if (bytes > 262144) {
        await reader.cancel()
        throw new ManagerAutomationSchedulerError(
          "Manager dispatch result exceeded its byte limit",
        )
      }
      chunks.push(chunk.value)
    }
  } finally {
    reader.releaseLock()
  }
  const body = new Uint8Array(bytes)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.length
  }
  return JSON.parse(new TextDecoder().decode(body)) as unknown
}
export async function runManagerAutomationTick(input: {
  db: PrismaClient
  baseUrl: string
  apiKey: string
  fetchImpl?: typeof fetch
}) {
  const target = new URL("/api/automations/runs/", input.baseUrl)
  if (
    target.protocol !== "https:" &&
    !(
      env.NODE_ENV !== "production" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(target.hostname)
    )
  )
    throw new ManagerAutomationSchedulerError(
      "Automation scheduler requires HTTPS",
    )
  const service = new ManagerAutomationService(input.db)
  let claimed = 0,
    failed = 0
  for (let index = 0; index < 4; index++) {
    const claim = await service.claimDue(MANAGER_BACKEND_PRINCIPAL)
    if (!claim) break
    claimed++
    let result: unknown
    let dispatchFailed = false
    try {
      const response = await (input.fetchImpl ?? fetch)(
        new URL(
          `/api/automations/runs/${encodeURIComponent(claim.run.documentId)}/enqueue`,
          target,
        ),
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${input.apiKey}`,
          },
          body: JSON.stringify({
            automation: claim.automation,
            leaseToken: claim.leaseToken,
          }),
          redirect: "error",
          signal: AbortSignal.timeout(120000),
        },
      )
      result = await readResult(response)
    } catch (error) {
      dispatchFailed = true
      result = {
        status: "failed",
        eligibleCount: 0,
        enqueuedCount: 0,
        skippedDuplicateCount: 0,
        errorCount: 1,
        jobDocumentIds: [],
        errors: [
          error instanceof ManagerAutomationSchedulerError
            ? error.message
            : "Manager dispatch failed or timed out.",
        ],
        summary: "Automation dispatch failed.",
      }
    }
    try {
      await service.completeRun(
        MANAGER_BACKEND_PRINCIPAL,
        claim.run.documentId,
        result,
        claim.leaseToken,
      )
    } catch (error) {
      dispatchFailed = true
      console.error("[manager-automations] settlement failed", {
        runId: claim.run.documentId,
        errorClass: error instanceof Error ? error.name : "UnknownError",
      })
    }
    if (dispatchFailed) failed++
  }
  return { claimed, failed }
}

const workflowKey = "manager-automation-scheduler"
const startupGraceMs = 300_000
let recoveryTimer: ReturnType<typeof setTimeout> | undefined

export async function ensureManagerAutomationSchedulerStarted() {
  if (env.MANAGER_AUTOMATIONS_ENABLED !== "true") return
  try {
    if (!env.MANAGER_API_BASE_URL || !env.MANAGER_AUTOMATION_API_KEY)
      throw new ManagerAutomationSchedulerError(
        "Enabled automations require MANAGER_API_BASE_URL and MANAGER_AUTOMATION_API_KEY",
      )
    await reconcileManagerAutomationScheduler()
  } finally {
    // Instrumentation may now mark startup complete. Keep reconciliation alive
    // for committed-but-unstarted ledgers, partial starts and later timer death.
    if (!recoveryTimer) {
      recoveryTimer = setTimeout(async () => {
        recoveryTimer = undefined
        try {
          await ensureManagerAutomationSchedulerStarted()
        } catch (error) {
          console.error("[manager-automations] timer recovery failed", {
            errorClass: error instanceof Error ? error.name : "UnknownError",
          })
        }
      }, 60_000)
      recoveryTimer.unref?.()
    }
  }
}

async function reconcileManagerAutomationScheduler() {
  const ledger = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${workflowKey},890))::text`
    const existing = await tx.workflowRun.findFirst({
      where: { workflowKey, status: { in: ["QUEUED", "RUNNING"] } },
      orderBy: { createdAt: "desc" },
    })
    if (existing) {
      if (existing.runtimeRunId) {
        const rows = await tx.$queryRaw<
          { status: string }[]
        >`SELECT status FROM workflow.workflow_runs WHERE id=${existing.runtimeRunId}`
        if (
          rows.length &&
          !["completed", "failed", "cancelled"].includes(rows[0].status)
        ) {
          return existing.status === "QUEUED"
            ? { action: "resume" as const, ledger: existing }
            : null
        }
        // Binding updates updatedAt, so missing-runtime grace starts at the
        // durable binding rather than allocation of the ledger.
        if (
          !rows.length &&
          Date.now() - existing.updatedAt.getTime() < startupGraceMs
        )
          return null
      } else if (Date.now() - existing.updatedAt.getTime() < startupGraceMs)
        return null
      await tx.workflowRun.update({
        where: { id: existing.id },
        data: {
          status: "FAILED",
          finishedAt: new Date(),
          summary: "Automation timer was interrupted.",
        },
      })
    }
    const created = await tx.workflowRun.create({
      data: {
        workflowKey,
        workflowName: "Manager automation scheduler",
        trigger: "SYSTEM",
        summary: "Automation timer queued.",
      },
    })
    return { action: "start" as const, ledger: created }
  })
  if (!ledger) return
  const world = getWorld()
  const selected = ledger.ledger
  if (ledger.action === "resume") {
    const runtime = await world.runs.get(selected.runtimeRunId!, {
      resolveData: "none",
    })
    // Same primitive as @workflow/world's reenqueueActiveRuns: replaying the
    // event log resumes this identity, rather than creating a second timer.
    await world.queue(
      `__wkf_workflow_${runtime.workflowName}`,
      { runId: runtime.runId },
      {
        deploymentId: runtime.deploymentId,
        specVersion: runtime.specVersion,
      },
    )
    await prisma.workflowRun.updateMany({
      where: { id: selected.id, runtimeRunId: runtime.runId, status: "QUEUED" },
      data: { status: "RUNNING", startedAt: new Date() },
    })
    return
  }
  const boundWorld: World = {
    ...world,
    // Installed @workflow/core 4.2.2 calls this World hook with its real,
    // internally generated ID BEFORE serialization, events.create and queue.
    // Preserve key resolution; a failed binding must stop all runtime effects.
    async getEncryptionKeyForRun(runOrId, context?: Record<string, unknown>) {
      if (typeof runOrId !== "string")
        return world.getEncryptionKeyForRun?.(runOrId)
      const bound = await prisma.workflowRun.updateMany({
        where: { id: selected.id, status: "QUEUED", runtimeRunId: null },
        data: { runtimeRunId: runOrId },
      })
      if (bound.count !== 1)
        throw new ManagerAutomationSchedulerError(
          "Automation timer ledger was retired before start",
        )
      return world.getEncryptionKeyForRun?.(runOrId, context)
    },
  }
  // start() can throw after a runtime side effect. Keep its identity recoverable
  // rather than marking FAILED and authorizing an immediate orphan replacement.
  const runtime = await start(runManagerAutomationScheduler, [selected.id], {
    world: boundWorld,
  })
  await prisma.workflowRun.updateMany({
    where: { id: selected.id, runtimeRunId: runtime.runId, status: "QUEUED" },
    data: { status: "RUNNING", startedAt: new Date() },
  })
}
