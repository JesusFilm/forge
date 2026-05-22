import { randomUUID } from "node:crypto"

import {
  batchCreateLogsArgsSchema,
  listLogsArgsSchema,
  logRecordSchema,
  type BatchCreateLogsArgs,
  type ListLogsArgs,
  type ListLogsResponse,
  type LogRecord,
} from "@mastra/core/storage"
import { ObservabilityPG, type Pool } from "@mastra/pg"

type PostgresLogObservabilityStoreConfig = {
  pool: Pool
  schemaName: string
}

type StoredLogRow = {
  sequence_id: string
  record: Record<string, unknown>
}

export class PostgresLogObservabilityStore extends ObservabilityPG {
  private readonly pool: Pool
  private readonly schemaName: string
  private readonly tableName: string

  constructor({ pool, schemaName }: PostgresLogObservabilityStoreConfig) {
    super({ pool, schemaName })
    this.pool = pool
    this.schemaName = schemaName
    this.tableName = `${quoteIdentifier(schemaName)}.mastra_logs`
  }

  override async init() {
    await super.init()
    await this.pool.query(
      `CREATE SCHEMA IF NOT EXISTS ${quoteIdentifier(this.schemaName)}`,
    )
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS ${this.tableName} (
        sequence_id BIGSERIAL PRIMARY KEY,
        log_id TEXT UNIQUE NOT NULL,
        timestamp TIMESTAMPTZ NOT NULL,
        record JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `)
    await this.pool.query(
      `CREATE INDEX IF NOT EXISTS mastra_logs_timestamp_idx ON ${this.tableName} (timestamp DESC)`,
    )
    await this.pool.query(
      `CREATE INDEX IF NOT EXISTS mastra_logs_record_gin_idx ON ${this.tableName} USING GIN (record)`,
    )
  }

  override async batchCreateLogs(args: BatchCreateLogsArgs) {
    const { logs } = batchCreateLogsArgsSchema.parse(args)

    for (const log of logs) {
      const record = logRecordSchema.parse({
        ...log,
        logId: log.logId ?? randomUUID(),
      })

      await this.pool.query(
        `
          INSERT INTO ${this.tableName} (log_id, timestamp, record)
          VALUES ($1, $2, $3::jsonb)
          ON CONFLICT (log_id) DO UPDATE
          SET timestamp = EXCLUDED.timestamp,
              record = EXCLUDED.record,
              updated_at = NOW()
        `,
        [
          record.logId,
          record.timestamp,
          JSON.stringify(serializeLogRecord(record)),
        ],
      )
    }
  }

  override async listLogs(args: ListLogsArgs): Promise<ListLogsResponse> {
    const { mode, filters, pagination, orderBy, after, limit } =
      listLogsArgsSchema.parse(args)

    const result = await this.pool.query<StoredLogRow>(
      `
        SELECT sequence_id::text, record
        FROM ${this.tableName}
        ORDER BY sequence_id ASC
      `,
    )

    const rows = result.rows
      .map((row) => ({
        sequenceId: Number(row.sequence_id),
        record: parseStoredLogRecord(row.record),
      }))
      .filter(({ record }) => matchesFilters(record, filters))

    if (mode === "delta") {
      const afterSequence = after == null ? 0 : Number(after)
      const deltaRows = rows
        .filter(({ sequenceId }) => sequenceId > afterSequence)
        .slice(0, limit)

      return {
        logs: deltaRows.map(({ record }) => record),
        delta: {
          limit,
          hasMore: rows.some(
            ({ sequenceId }) =>
              sequenceId > (deltaRows.at(-1)?.sequenceId ?? afterSequence),
          ),
        },
        deltaCursor: String(deltaRows.at(-1)?.sequenceId ?? afterSequence),
      }
    }

    const direction = orderBy.direction === "DESC" ? -1 : 1
    const sortedRows = rows.sort(
      (a, b) =>
        direction *
        (a.record.timestamp.getTime() - b.record.timestamp.getTime()),
    )
    const page = Number(pagination.page)
    const perPage = Number(pagination.perPage)
    const start = page * perPage
    const logs = sortedRows.slice(start, start + perPage)

    return {
      logs: logs.map(({ record }) => record),
      pagination: {
        total: sortedRows.length,
        page,
        perPage,
        hasMore: start + perPage < sortedRows.length,
      },
    }
  }
}

function serializeLogRecord(record: LogRecord) {
  return {
    ...record,
    timestamp: record.timestamp.toISOString(),
  }
}

function parseStoredLogRecord(record: Record<string, unknown>) {
  return logRecordSchema.parse({
    ...record,
    timestamp: new Date(String(record.timestamp)),
  })
}

function matchesFilters(
  record: LogRecord,
  filters: ReturnType<typeof listLogsArgsSchema.parse>["filters"],
) {
  if (!filters) return true

  if (filters.level) {
    const levels = Array.isArray(filters.level)
      ? filters.level
      : [filters.level]
    if (!levels.includes(record.level)) return false
  }

  if (filters.timestamp?.start) {
    const passes = filters.timestamp.startExclusive
      ? record.timestamp > filters.timestamp.start
      : record.timestamp >= filters.timestamp.start
    if (!passes) return false
  }

  if (filters.timestamp?.end) {
    const passes = filters.timestamp.endExclusive
      ? record.timestamp < filters.timestamp.end
      : record.timestamp <= filters.timestamp.end
    if (!passes) return false
  }

  const stringFilterKeys = [
    "source",
    "traceId",
    "spanId",
    "entityType",
    "entityName",
    "entityVersionId",
    "parentEntityVersionId",
    "rootEntityVersionId",
    "userId",
    "organizationId",
    "experimentId",
    "serviceName",
    "environment",
    "parentEntityType",
    "parentEntityName",
    "rootEntityType",
    "rootEntityName",
    "resourceId",
    "runId",
    "sessionId",
    "threadId",
    "requestId",
    "executionSource",
  ] as const

  for (const key of stringFilterKeys) {
    if (filters[key] != null && record[key] !== filters[key]) return false
  }

  if (filters.tags?.length) {
    const tags = new Set(record.tags ?? [])
    if (!filters.tags.every((tag) => tags.has(tag))) return false
  }

  return true
}

function quoteIdentifier(value: string) {
  return `"${value.replaceAll('"', '""')}"`
}
