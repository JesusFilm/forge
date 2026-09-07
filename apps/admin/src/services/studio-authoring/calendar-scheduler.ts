import { start } from "workflow/api"
import { prisma } from "@/db/client"
import { env } from "@/config/env"
import { SYSTEM_PRINCIPAL } from "@/auth/principal"
import { StudioCalendarService } from "./calendar"
import {
  runStudioCalendarScheduler,
  runStudioCalendarPublicationScheduler,
} from "@/workflows/studioCalendar"
const workflowKey = "studio-calendar-scheduler"

export type CalendarTickResult = {
  cursor?: string
  failures: Array<{
    calendarId: string
    stage: "admission" | "dispatch" | "settlement"
    errorClass: string
  }>
}
export async function runStudioCalendarTick(
  cursor?: string,
): Promise<CalendarTickResult> {
  const failures: CalendarTickResult["failures"] = []
  if (!env.MANAGER_API_BASE_URL || !env.MANAGER_TRIGGER_API_KEY)
    return { failures }
  const target = new URL(
    "/api/admin-trigger/studio-calendar",
    env.MANAGER_API_BASE_URL,
  )
  if (
    target.protocol !== "https:" &&
    !(
      env.STUDIO_ENVIRONMENT === "local" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(target.hostname)
    )
  )
    throw new Error("Calendar worker requires HTTPS")
  const service = new StudioCalendarService(prisma)
  const expired = await prisma.studioPlanningRun.findMany({
    where: {
      status: { in: ["RUNNING", "DISPATCHED"] },
      createdAt: { lt: new Date(Date.now() - 300000) },
    },
    select: { id: true },
    take: 20,
  })
  for (const run of expired)
    await service.failPlanning(SYSTEM_PRINCIPAL, {
      runId: run.id,
      reason: "INTERRUPTED",
    })
  const calendars = await prisma.studioCalendar.findMany({
    where: {
      ...(cursor ? { id: { gt: cursor } } : {}),
      settings: { path: ["automationEnabled"], equals: true },
    },
    orderBy: { id: "asc" },
    take: 4,
    select: { id: true },
  })
  for (const calendar of calendars) {
    let run: Awaited<
      ReturnType<StudioCalendarService["beginAutomaticPlanning"]>
    > = null
    let stage: CalendarTickResult["failures"][number]["stage"] = "admission"
    try {
      run = await service.beginAutomaticPlanning(SYSTEM_PRINCIPAL, calendar.id)
      if (!run || run.status !== "RUNNING") continue
      stage = "dispatch"
      const response = await fetch(target, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${env.MANAGER_TRIGGER_API_KEY}`,
        },
        body: JSON.stringify({ runId: run.id }),
        redirect: "error",
        signal: AbortSignal.timeout(90000),
      })
      await response.body?.cancel()
      if (!response.ok) {
        failures.push({
          calendarId: calendar.id,
          stage,
          errorClass: "HTTP_" + response.status,
        })
        stage = "settlement"
        await service.failPlanning(SYSTEM_PRINCIPAL, {
          runId: run.id,
          reason: response.status === 503 ? "UNAVAILABLE" : "INTERRUPTED",
        })
      }
    } catch (error) {
      failures.push({
        calendarId: calendar.id,
        stage,
        errorClass:
          error instanceof Error ? error.constructor.name : "UnknownError",
      })
      if (run && stage !== "settlement") {
        try {
          await service.failPlanning(SYSTEM_PRINCIPAL, {
            runId: run.id,
            reason: "INTERRUPTED",
          })
        } catch (error) {
          failures.push({
            calendarId: calendar.id,
            stage: "settlement",
            errorClass:
              error instanceof Error ? error.constructor.name : "UnknownError",
          })
        }
      }
    }
  }
  return {
    cursor: calendars.length === 4 ? calendars[3].id : undefined,
    failures,
  }
}

/** Reuse the workflow ledger and runtime; per-occurrence and dispatch claims are
 * canonical DB guards even if boot dies between queueing and recording runtime ID. */
export async function ensureStudioCalendarSchedulerStarted() {
  return ensureCalendarTimer(workflowKey, runStudioCalendarScheduler)
}
export async function ensureStudioCalendarPublicationSchedulerStarted() {
  return ensureCalendarTimer(
    "studio-calendar-publication",
    runStudioCalendarPublicationScheduler,
  )
}
async function ensureCalendarTimer(
  workflowKey: string,
  workflow: typeof runStudioCalendarScheduler,
) {
  if (!env.MANAGER_API_BASE_URL || !env.MANAGER_TRIGGER_API_KEY) return
  const ledger = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${workflowKey},461))::text`
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
          rows.length > 0 &&
          !["completed", "failed", "cancelled"].includes(rows[0].status)
        )
          return null
      } else if (Date.now() - existing.createdAt.getTime() < 300000) return null
      await tx.workflowRun.update({
        where: { id: existing.id },
        data: {
          status: "FAILED",
          finishedAt: new Date(),
          summary:
            "Calendar scheduler runtime stopped or startup was interrupted.",
        },
      })
    }
    return tx.workflowRun.create({
      data: {
        workflowKey,
        workflowName: "Studio calendar scheduler",
        trigger: "SYSTEM",
        summary: "Studio calendar timer queued.",
      },
    })
  })
  if (!ledger) return
  try {
    const runtime = await start(workflow, [])
    await prisma.workflowRun.update({
      where: { id: ledger.id },
      data: {
        runtimeRunId: runtime.runId,
        status: "RUNNING",
        startedAt: new Date(),
      },
    })
  } catch (error) {
    await prisma.workflowRun.update({
      where: { id: ledger.id },
      data: {
        status: "FAILED",
        finishedAt: new Date(),
        summary: "Calendar scheduler could not start.",
      },
    })
    throw error
  }
}
