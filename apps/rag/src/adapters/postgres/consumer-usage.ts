import { inventoryCovers, type DeploymentInterval } from "./usage-coverage.js"
import { randomUUID } from "node:crypto"
import { Prisma, type PrismaClient } from "../../generated/prisma/index.js"
import {
  UsageError,
  validateUsageWindow,
  type UsageWriter,
  type UsageReader,
  type UsageWindow,
  type UsageReport,
  type ServiceDenial,
} from "../../contracts/consumer-usage.js"

export class PostgresUsageStore implements UsageWriter, UsageReader {
  constructor(
    private readonly db: PrismaClient,
    private readonly deploymentId = "unconfigured",
  ) {}
  async open(instance: string, at: Date): Promise<void> {
    await this.db
      .$executeRaw`INSERT INTO usage_private.collectors(id, started_at, complete_through, heartbeat_at, deployment_id) VALUES(${instance}::uuid, ${at}, ${at}, ${at}, ${this.deploymentId})`
  }
  async admit(instance: string, consumerId: string, at: Date): Promise<string> {
    const id = randomUUID()
    await this.db.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<
        Array<{ id: string }>
      >`SELECT id FROM usage_private.collectors WHERE id=${instance}::uuid AND stopped_at IS NULL AND complete_through <= ${at} FOR UPDATE`
      if (!rows.length) throw new UsageError("unavailable")
      await tx.$executeRaw`INSERT INTO usage_private.pending(id, collector_id, consumer_id, admitted_at) VALUES(${id}::uuid, ${instance}::uuid, ${consumerId}::uuid, ${at})`
      await tx.$executeRaw`INSERT INTO usage_private.minutes(consumer_id, minute, request_count, last_activity_at) VALUES(${consumerId}::uuid, date_trunc('minute', ${at}::timestamptz, 'UTC'), 1, ${at}) ON CONFLICT(consumer_id, minute) DO UPDATE SET request_count=usage_private.minutes.request_count+1, last_activity_at=greatest(usage_private.minutes.last_activity_at, EXCLUDED.last_activity_at)`
    })
    return id
  }
  async complete(attempt: string, successful: boolean): Promise<void> {
    await this.db.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<
        Array<{ consumer_id: string; admitted_at: Date }>
      >`DELETE FROM usage_private.pending WHERE id=${attempt}::uuid RETURNING consumer_id, admitted_at`
      if (successful && rows[0]) {
        const row = rows[0]
        await tx.$executeRaw`UPDATE usage_private.minutes SET successful_count=successful_count+1 WHERE consumer_id=${row.consumer_id}::uuid AND minute=date_trunc('minute', ${row.admitted_at}::timestamptz, 'UTC')`
      }
    })
  }
  async checkpoint(instance: string, at: Date, stop = false): Promise<void> {
    await this.db
      .$executeRaw`UPDATE usage_private.collectors SET complete_through=greatest(complete_through, ${at}), heartbeat_at=${at}, stopped_at=CASE WHEN ${stop} THEN ${at} ELSE NULL END WHERE id=${instance}::uuid AND stopped_at IS NULL`
  }
  async gap(instance: string, from: Date, to: Date): Promise<void> {
    await this.db
      .$executeRaw`INSERT INTO usage_private.gaps(collector_id, started_at, ended_at) VALUES(${instance}::uuid, ${from}, ${to}) ON CONFLICT(collector_id, started_at) DO UPDATE SET ended_at=greatest(usage_private.gaps.ended_at, EXCLUDED.ended_at)`
  }
  async denial(reason: ServiceDenial, at: Date): Promise<void> {
    await this.db
      .$executeRaw`INSERT INTO usage_private.denials(minute, reason, request_count) VALUES(date_trunc('minute', ${at}::timestamptz, 'UTC'), ${reason}, 1) ON CONFLICT(minute, reason) DO UPDATE SET request_count=usage_private.denials.request_count+1`
  }
  /** Only after an operator confirms this instance is stopped. A stale lease alone is not proof of death. */
  async reconcile(instance: string, at: Date): Promise<void> {
    await this.db.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<
        Array<{ complete_through: Date }>
      >`SELECT complete_through FROM usage_private.collectors WHERE id=${instance}::uuid AND stopped_at IS NULL AND heartbeat_at < ${new Date(at.getTime() - 30000)} FOR UPDATE`
      if (!rows[0]) throw new UsageError("unavailable")
      const pending = await tx.$queryRaw<
        Array<{ admitted_at: Date }>
      >`DELETE FROM usage_private.pending WHERE collector_id=${instance}::uuid RETURNING admitted_at`
      const from = new Date(
        Math.min(
          rows[0].complete_through.getTime(),
          ...pending.map((p) => p.admitted_at.getTime()),
        ),
      )
      await tx.$executeRaw`INSERT INTO usage_private.gaps(collector_id, started_at, ended_at) VALUES(${instance}::uuid, ${from}, ${at}) ON CONFLICT(collector_id, started_at) DO UPDATE SET ended_at=greatest(usage_private.gaps.ended_at, EXCLUDED.ended_at)`
      await tx.$executeRaw`UPDATE usage_private.collectors SET complete_through=${at}, heartbeat_at=${at}, stopped_at=${at} WHERE id=${instance}::uuid`
    })
  }
  async report(window: UsageWindow, now = new Date()): Promise<UsageReport> {
    validateUsageWindow(window)
    return this.db.$transaction(
      async (tx) => {
        const labels = await tx.$queryRaw<
          Array<{ label: string }>
        >`SELECT label FROM usage_private.consumer_labels WHERE consumer_id=${window.consumerId}::uuid`
        if (!labels[0]) throw new UsageError("unknown_consumer")
        const [counts] = await tx.$queryRaw<
          Array<{ requests: bigint; successes: bigint; last: Date | null }>
        >`SELECT coalesce(sum(request_count),0)::bigint AS requests, coalesce(sum(successful_count),0)::bigint AS successes, max(last_activity_at) AS last FROM usage_private.report_minutes WHERE consumer_id=${window.consumerId}::uuid AND minute >= ${window.from} AND minute < ${window.to}`
        const collectors = await tx.$queryRaw<
          Array<{
            deployment_id: string
            started_at: Date
            complete_through: Date
            heartbeat_at: Date
            stopped_at: Date | null
          }>
        >`SELECT * FROM usage_private.report_collectors WHERE started_at < ${window.to} AND (stopped_at IS NULL OR stopped_at >= ${window.from}) ORDER BY started_at`
        const deployments = await tx.$queryRaw<
          DeploymentInterval[]
        >`SELECT * FROM usage_private.report_inventory WHERE starts_at < ${window.to} AND (ends_at IS NULL OR ends_at >= ${window.from})`
        const [problems] = await tx.$queryRaw<
          Array<{
            pending: boolean
            gaps: boolean
            uncertain_from: Date | null
          }>
        >`SELECT EXISTS(SELECT 1 FROM usage_private.report_pending WHERE admitted_at >= ${window.from} AND admitted_at < ${window.to}) AS pending, EXISTS(SELECT 1 FROM usage_private.report_gaps WHERE started_at < ${window.to} AND ended_at > ${window.from}) AS gaps, least(
        (SELECT min(admitted_at) FROM usage_private.report_pending WHERE admitted_at >= ${window.from} AND admitted_at < ${window.to}),
        (SELECT min(greatest(started_at, ${window.from})) FROM usage_private.report_gaps WHERE started_at < ${window.to} AND ended_at > ${window.from})
      ) AS uncertain_from`
        let through = window.from.getTime(),
          unavailable = !inventoryCovers(
            window.from,
            window.to,
            collectors,
            deployments,
          )
        for (const c of collectors) {
          if (c.started_at.getTime() > through) unavailable = true
          const end = c.stopped_at ?? window.to
          if (
            c.complete_through < end ||
            (!c.stopped_at &&
              window.to > c.complete_through &&
              now.getTime() - c.heartbeat_at.getTime() > 30000)
          )
            unavailable = true
          through = Math.max(through, c.complete_through.getTime())
        }
        if (through < window.to.getTime() || !collectors.length)
          unavailable = true
        const requests = Number(counts.requests),
          successes = Number(counts.successes)
        if (!Number.isSafeInteger(requests) || !Number.isSafeInteger(successes))
          throw new UsageError("unavailable")
        return {
          consumerId: window.consumerId,
          label: labels[0].label,
          windowStart: window.from.toISOString(),
          windowEnd: window.to.toISOString(),
          requestCount: requests,
          successfulRequestCount: successes,
          lastActivityAt: counts.last?.toISOString() ?? null,
          generatedAt: now.toISOString(),
          completeThrough: unavailable
            ? null
            : new Date(
                Math.min(
                  through,
                  window.to.getTime(),
                  problems.uncertain_from?.getTime() ?? Infinity,
                ),
              ).toISOString(),
          coverageStatus: unavailable
            ? "unavailable"
            : problems.pending || problems.gaps
              ? "partial"
              : "complete",
        }
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    )
  }
}
