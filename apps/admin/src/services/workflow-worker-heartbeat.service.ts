import { randomUUID } from "node:crypto"
import { hostname } from "node:os"
import { Prisma } from "@prisma/client"
import { prisma } from "@/db/client"

const HEARTBEAT_INTERVAL_MS = 15_000
const STALE_AFTER_MS = 45_000

type HeartbeatGlobal = typeof globalThis & {
  __forgeAdminWorkflowWorkerHeartbeat?: {
    workerId: string
    startedAt: Date
    interval: NodeJS.Timeout | null
  }
}

type WorkflowWorkerHeartbeatRow = {
  workerId: string
  service: string
  status: string
  startedAt: Date
  lastSeenAt: Date
  currentJob: string | null
  currentRunId: string | null
}

type LockedGraphileJobRow = {
  workerId: string
  lockedJobs: bigint
  lockedAt: Date
  task: string
  queueName: string | null
}

type RelationExistsRow = {
  exists: boolean
}

export type WorkflowWorkerStatusRow = {
  id: string
  statusLabel: string
  statusTone: "success" | "warning" | "danger" | "info" | "muted"
  meta: string
  detail: string
}

function heartbeatGlobal() {
  return globalThis as HeartbeatGlobal
}

export function getWorkflowHeartbeatWorkerId() {
  const state = heartbeatGlobal().__forgeAdminWorkflowWorkerHeartbeat
  if (state) return state.workerId

  return [
    "admin",
    hostname().replace(/[^a-zA-Z0-9_.-]/g, "-"),
    process.pid,
    randomUUID().slice(0, 8),
  ].join(":")
}

async function recordWorkflowWorkerHeartbeat(workerId: string) {
  const details = JSON.stringify({ pid: process.pid, host: hostname() })

  await prisma.$executeRaw`
    INSERT INTO workflow_worker_heartbeat (
      worker_id,
      service,
      status,
      started_at,
      last_seen_at,
      details
    )
    VALUES (
      ${workerId},
      'admin',
      'online',
      now(),
      now(),
      CAST(${details} AS jsonb)
    )
    ON CONFLICT (worker_id) DO UPDATE SET
      status = 'online',
      last_seen_at = now(),
      details = EXCLUDED.details
  `
}

export async function startWorkflowWorkerHeartbeat() {
  const current = heartbeatGlobal().__forgeAdminWorkflowWorkerHeartbeat
  if (current) {
    await recordWorkflowWorkerHeartbeat(current.workerId).catch(() => {})
    return current.workerId
  }

  const workerId = getWorkflowHeartbeatWorkerId()
  await recordWorkflowWorkerHeartbeat(workerId).catch(() => {})

  const interval = setInterval(() => {
    void recordWorkflowWorkerHeartbeat(workerId).catch(() => {})
  }, HEARTBEAT_INTERVAL_MS)
  interval.unref?.()

  heartbeatGlobal().__forgeAdminWorkflowWorkerHeartbeat = {
    workerId,
    startedAt: new Date(),
    interval,
  }

  return workerId
}

function formatRelative(date: Date) {
  const deltaMs = Date.now() - date.getTime()
  if (!Number.isFinite(deltaMs) || deltaMs < 0) return "now"
  const seconds = Math.floor(deltaMs / 1000)
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ${minutes % 60}m ago`
}

function workerStatus(row: WorkflowWorkerHeartbeatRow) {
  const stale = Date.now() - row.lastSeenAt.getTime() > STALE_AFTER_MS
  if (stale) {
    return {
      label: "Stale",
      tone: "danger" as const,
      detail: `Last heartbeat ${formatRelative(row.lastSeenAt)}.`,
    }
  }

  return {
    label: row.status === "running" ? "Running" : "Online",
    tone: row.status === "running" ? ("info" as const) : ("success" as const),
    detail: `Heartbeat ${formatRelative(row.lastSeenAt)}.`,
  }
}

async function loadHeartbeatRows() {
  return prisma.$queryRaw<WorkflowWorkerHeartbeatRow[]>(Prisma.sql`
    SELECT
      worker_id AS "workerId",
      service,
      status,
      started_at AS "startedAt",
      last_seen_at AS "lastSeenAt",
      current_job AS "currentJob",
      current_run_id AS "currentRunId"
    FROM workflow_worker_heartbeat
    ORDER BY last_seen_at DESC
    LIMIT 10
  `)
}

async function loadLockedGraphileJobRows() {
  const [jobsView] = await prisma.$queryRaw<RelationExistsRow[]>(Prisma.sql`
    SELECT to_regclass('graphile_worker.jobs') IS NOT NULL AS "exists"
  `)

  if (!jobsView?.exists) return []

  return prisma.$queryRaw<LockedGraphileJobRow[]>(Prisma.sql`
    SELECT
      locked_by AS "workerId",
      count(*)::bigint AS "lockedJobs",
      min(locked_at) AS "lockedAt",
      min(task_identifier) AS "task",
      min(queue_name) AS "queueName"
    FROM graphile_worker.jobs
    WHERE locked_by IS NOT NULL
    GROUP BY locked_by
    ORDER BY min(locked_at) ASC
    LIMIT 10
  `)
}

export async function loadWorkflowWorkerStatusRows(): Promise<
  WorkflowWorkerStatusRow[]
> {
  try {
    const heartbeats = await loadHeartbeatRows()
    const lockedJobs = await loadLockedGraphileJobRows().catch(() => [])

    const heartbeatRows = heartbeats.map((row) => {
      const status = workerStatus(row)
      return {
        id: row.workerId,
        statusLabel: status.label,
        statusTone: status.tone,
        meta: `${row.service} / started ${formatRelative(row.startedAt)}`,
        detail: row.currentJob
          ? `${status.detail} Current job: ${row.currentJob}.`
          : status.detail,
      }
    })

    const lockedJobRows = lockedJobs.map((row) => ({
      id: `graphile:${row.workerId}`,
      statusLabel: "Processing",
      statusTone: "info" as const,
      meta: row.queueName ?? row.task,
      detail: `${Number(row.lockedJobs)} locked job(s) since ${formatRelative(row.lockedAt)}.`,
    }))

    return [...heartbeatRows, ...lockedJobRows]
  } catch {
    return [
      {
        id: "workflow-worker-heartbeat-unavailable",
        statusLabel: "Unknown",
        statusTone: "muted",
        meta: "heartbeat unavailable",
        detail: "Worker heartbeat data is not available yet.",
      },
    ]
  }
}
