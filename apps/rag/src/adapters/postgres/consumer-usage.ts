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
  constructor(private readonly db: PrismaClient) {}
  async admit(consumerId: string, at: Date): Promise<string> {
    const id = randomUUID()
    await this.db.$transaction(async (tx) => {
      await tx.$executeRaw`INSERT INTO usage_private.pending(id, consumer_id, admitted_at) VALUES(${id}::uuid, ${consumerId}::uuid, ${at})`
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
  async denial(reason: ServiceDenial, at: Date): Promise<void> {
    await this.db
      .$executeRaw`INSERT INTO usage_private.denials(minute, reason, request_count) VALUES(date_trunc('minute', ${at}::timestamptz, 'UTC'), ${reason}, 1) ON CONFLICT(minute, reason) DO UPDATE SET request_count=usage_private.denials.request_count+1`
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
        }
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    )
  }
}
