import { randomUUID } from "node:crypto"

import {
  DevotionalAttemptSchema,
  assertBoundedAttemptState,
  type DevotionalAttempt,
  type DevotionalSourceRef,
} from "./state-schema"

export type BeginRetryInput = {
  parentRunId: string
  idempotencyKey: string
  requestHash: string
}

export type BeginRetryResult =
  | { kind: "created" | "existing"; attempt: DevotionalAttempt }
  | { kind: "conflict"; attempt: DevotionalAttempt }

export type MarkAttemptReadyInput = {
  catalogGeneration: number
  runId: string
  selectedSources: DevotionalSourceRef[]
}

export interface DevotionalAttemptStore {
  beginRetry(input: BeginRetryInput): Promise<BeginRetryResult>
  markReady(attemptId: string, input: MarkAttemptReadyInput): Promise<void>
  markFailed(attemptId: string, reason: string): Promise<void>
  get(attemptId: string): Promise<DevotionalAttempt | undefined>
}

export class InMemoryDevotionalAttemptStore implements DevotionalAttemptStore {
  private readonly attempts = new Map<string, DevotionalAttempt>()
  private readonly byParentAndKey = new Map<string, string>()

  async beginRetry(input: BeginRetryInput): Promise<BeginRetryResult> {
    const key = `${input.parentRunId}\0${input.idempotencyKey}`
    const existingId = this.byParentAndKey.get(key)
    if (existingId) {
      const attempt = this.attempts.get(existingId)!
      return {
        kind:
          attempt.requestHash === input.requestHash ? "existing" : "conflict",
        attempt: structuredClone(attempt),
      }
    }

    const attemptNumber =
      Math.max(
        0,
        ...[...this.attempts.values()]
          .filter((attempt) => attempt.parentRunId === input.parentRunId)
          .map((attempt) => attempt.attemptNumber),
      ) + 1
    const now = new Date().toISOString()
    const attempt = DevotionalAttemptSchema.parse({
      id: randomUUID(),
      parentRunId: input.parentRunId,
      attemptNumber,
      idempotencyKey: input.idempotencyKey,
      requestHash: input.requestHash,
      provisioningState: "provisioning",
      selectedSources: [],
      createdAt: now,
      updatedAt: now,
    })
    this.attempts.set(attempt.id, attempt)
    this.byParentAndKey.set(key, attempt.id)
    return { kind: "created", attempt: structuredClone(attempt) }
  }

  async markReady(
    attemptId: string,
    input: MarkAttemptReadyInput,
  ): Promise<void> {
    const attempt = this.require(attemptId)
    const next = DevotionalAttemptSchema.parse(
      assertBoundedAttemptState({
        ...attempt,
        ...input,
        provisioningState: "ready",
        failureReason: undefined,
        updatedAt: new Date().toISOString(),
      }),
    )
    this.attempts.set(attemptId, next)
  }

  async markFailed(attemptId: string, reason: string): Promise<void> {
    const attempt = this.require(attemptId)
    this.attempts.set(
      attemptId,
      DevotionalAttemptSchema.parse({
        ...attempt,
        provisioningState: "failed",
        failureReason: reason.slice(0, 2_000),
        updatedAt: new Date().toISOString(),
      }),
    )
  }

  async get(attemptId: string): Promise<DevotionalAttempt | undefined> {
    const attempt = this.attempts.get(attemptId)
    return attempt ? structuredClone(attempt) : undefined
  }

  private require(attemptId: string): DevotionalAttempt {
    const attempt = this.attempts.get(attemptId)
    if (!attempt) throw new Error(`Unknown devotional attempt ${attemptId}`)
    return attempt
  }
}

export type SqlQueryResult<Row> = { rows: Row[]; rowCount?: number | null }
export interface DevotionalSqlClient {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<SqlQueryResult<Row>>
}
export interface DevotionalTransactionalDatabase {
  transaction<T>(work: (client: DevotionalSqlClient) => Promise<T>): Promise<T>
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<SqlQueryResult<Row>>
}

type AttemptRow = {
  id: string
  parent_run_id: string
  attempt_number: number
  idempotency_key: string
  request_hash: string
  provisioning_state: string
  catalog_generation: string | number | null
  run_id: string | null
  selected_sources: unknown
  failure_reason: string | null
  created_at: Date | string
  updated_at: Date | string
}

function iso(value: Date | string): string {
  return (value instanceof Date ? value : new Date(value)).toISOString()
}

function fromRow(row: AttemptRow): DevotionalAttempt {
  return DevotionalAttemptSchema.parse({
    id: row.id,
    parentRunId: row.parent_run_id,
    attemptNumber: row.attempt_number,
    idempotencyKey: row.idempotency_key,
    requestHash: row.request_hash,
    provisioningState: row.provisioning_state,
    ...(row.catalog_generation == null
      ? {}
      : { catalogGeneration: Number(row.catalog_generation) }),
    ...(row.run_id == null ? {} : { runId: row.run_id }),
    selectedSources: row.selected_sources,
    ...(row.failure_reason == null
      ? {}
      : { failureReason: row.failure_reason }),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  })
}

const ATTEMPT_COLUMNS = `
  id, parent_run_id, attempt_number, idempotency_key, request_hash,
  provisioning_state, catalog_generation, run_id, selected_sources,
  failure_reason, created_at, updated_at
`

export class PostgresDevotionalAttemptStore implements DevotionalAttemptStore {
  constructor(private readonly database: DevotionalTransactionalDatabase) {}

  async beginRetry(input: BeginRetryInput): Promise<BeginRetryResult> {
    return this.database.transaction(async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        `devotional-attempt:${input.parentRunId}`,
      ])
      const existing = await client.query<AttemptRow>(
        `SELECT ${ATTEMPT_COLUMNS}
         FROM devotional_workspace.workflow_attempts
         WHERE parent_run_id = $1 AND idempotency_key = $2
         FOR UPDATE`,
        [input.parentRunId, input.idempotencyKey],
      )
      if (existing.rows[0]) {
        const attempt = fromRow(existing.rows[0])
        return {
          kind:
            attempt.requestHash === input.requestHash ? "existing" : "conflict",
          attempt,
        }
      }

      const inserted = await client.query<AttemptRow>(
        `INSERT INTO devotional_workspace.workflow_attempts (
           id, parent_run_id, attempt_number, idempotency_key, request_hash,
           provisioning_state, selected_sources
         )
         SELECT $1, $2, COALESCE(MAX(attempt_number), 0) + 1, $3, $4,
                'provisioning', '[]'::jsonb
         FROM devotional_workspace.workflow_attempts
         WHERE parent_run_id = $2
         RETURNING ${ATTEMPT_COLUMNS}`,
        [
          randomUUID(),
          input.parentRunId,
          input.idempotencyKey,
          input.requestHash,
        ],
      )
      return { kind: "created", attempt: fromRow(inserted.rows[0]!) }
    })
  }

  async markReady(
    attemptId: string,
    input: MarkAttemptReadyInput,
  ): Promise<void> {
    assertBoundedAttemptState(input)
    const result = await this.database.query(
      `UPDATE devotional_workspace.workflow_attempts
       SET provisioning_state = 'ready', catalog_generation = $2, run_id = $3,
           selected_sources = $4::jsonb, failure_reason = NULL,
           updated_at = now()
       WHERE id = $1`,
      [
        attemptId,
        input.catalogGeneration,
        input.runId,
        JSON.stringify(input.selectedSources),
      ],
    )
    if (result.rowCount !== 1) throw new Error(`Unknown attempt ${attemptId}`)
  }

  async markFailed(attemptId: string, reason: string): Promise<void> {
    const result = await this.database.query(
      `UPDATE devotional_workspace.workflow_attempts
       SET provisioning_state = 'failed', failure_reason = $2,
           updated_at = now()
       WHERE id = $1`,
      [attemptId, reason.slice(0, 2_000)],
    )
    if (result.rowCount !== 1) throw new Error(`Unknown attempt ${attemptId}`)
  }

  async get(attemptId: string): Promise<DevotionalAttempt | undefined> {
    const result = await this.database.query<AttemptRow>(
      `SELECT ${ATTEMPT_COLUMNS}
       FROM devotional_workspace.workflow_attempts WHERE id = $1`,
      [attemptId],
    )
    return result.rows[0] ? fromRow(result.rows[0]) : undefined
  }
}
