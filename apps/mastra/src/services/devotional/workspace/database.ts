import {
  Pool,
  type PoolConfig,
  type QueryResult,
  type QueryResultRow,
} from "pg"

import { getDevotionalWorkspaceEnvironment } from "../../../config/env"
import type {
  WorkspaceMutationAuditRecord,
  WorkspaceMutationAuditSink,
} from "./audited-filesystem"

export const DEVOTIONAL_WORKSPACE_SCHEMA = "devotional_workspace"
export const REQUIRED_DEVOTIONAL_MIGRATION = {
  version: 1,
  name: "001-devotional-workspace.sql",
  sha256: "7e2d729677d829756ac6dc3980cc2bb78dd211b56b47db66feb752c1ce971dcf",
} as const
export const MAX_DEVOTIONAL_DATABASE_POOL_SIZE = 3

export type QueryExecutor = {
  query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<QueryResult<T>>
}

export type DevotionalDatabase = QueryExecutor & {
  readonly pool: Pool
  readonly maxConnections: number
  transaction<T>(work: (client: QueryExecutor) => Promise<T>): Promise<T>
  close(): Promise<void>
}

type TransactionClient = QueryExecutor & { release(): void }
type TransactionPool = { connect(): Promise<TransactionClient> }

export async function runDevotionalTransaction<T>(
  pool: TransactionPool,
  work: (client: QueryExecutor) => Promise<T>,
): Promise<T> {
  const client = await pool.connect()
  try {
    await client.query("begin")
    const result = await work(client)
    await client.query("commit")
    return result
  } catch (error) {
    await client.query("rollback").catch(() => undefined)
    throw error
  } finally {
    client.release()
  }
}

export function createDevotionalDatabase(options: {
  connectionString: string
  maxConnections?: number
  pool?: Pool
}): DevotionalDatabase {
  const maxConnections =
    options.maxConnections ?? MAX_DEVOTIONAL_DATABASE_POOL_SIZE
  if (
    !Number.isInteger(maxConnections) ||
    maxConnections < 2 ||
    maxConnections > MAX_DEVOTIONAL_DATABASE_POOL_SIZE
  ) {
    throw new Error(
      `devotional database pool must contain 2-${MAX_DEVOTIONAL_DATABASE_POOL_SIZE} connections`,
    )
  }

  const ownsPool = !options.pool
  const pool =
    options.pool ??
    new Pool({
      connectionString: options.connectionString,
      max: maxConnections,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
      allowExitOnIdle: true,
    } satisfies PoolConfig)

  return {
    pool,
    maxConnections,
    query: (text, values) => pool.query(text, values as unknown[] | undefined),
    transaction: (work) =>
      runDevotionalTransaction(
        {
          connect: async () => {
            const client = await pool.connect()
            return {
              query: (text, values) =>
                client.query(text, values as unknown[] | undefined),
              release: () => client.release(),
            }
          },
        },
        work,
      ),
    close: () => (ownsPool ? pool.end() : Promise.resolve()),
  }
}

export type DevotionalSchemaReadiness =
  | { ready: true; version: number }
  | { ready: false; version?: number; reason: string }

export async function getDevotionalSchemaReadiness(
  database: QueryExecutor,
): Promise<DevotionalSchemaReadiness> {
  try {
    const result = await database.query<{ version: number | string }>(
      `select version
         from ${DEVOTIONAL_WORKSPACE_SCHEMA}.schema_migrations
        where version = $1
          and name = $2
          and sha256 = $3
        limit 1`,
      [
        REQUIRED_DEVOTIONAL_MIGRATION.version,
        REQUIRED_DEVOTIONAL_MIGRATION.name,
        REQUIRED_DEVOTIONAL_MIGRATION.sha256,
      ],
    )
    const version = Number(result.rows[0]?.version ?? 0)
    if (version !== REQUIRED_DEVOTIONAL_MIGRATION.version) {
      return {
        ready: false,
        version,
        reason: `required devotional migration ${REQUIRED_DEVOTIONAL_MIGRATION.version} is unavailable`,
      }
    }
    return { ready: true, version }
  } catch {
    return {
      ready: false,
      reason: "devotional workspace schema is unavailable",
    }
  }
}

export async function assertDevotionalSchemaReady(
  database: QueryExecutor,
): Promise<void> {
  const readiness = await getDevotionalSchemaReadiness(database)
  if (!readiness.ready) throw new Error(readiness.reason)
}

export async function hasDevotionalVectorCapability(
  database: QueryExecutor,
): Promise<boolean> {
  try {
    const result = await database.query<{ available: boolean }>(
      "select exists (select 1 from pg_extension where extname = 'vector') as available",
    )
    return result.rows[0]?.available === true
  } catch {
    return false
  }
}

export type DevotionalCutoverReadiness =
  | {
      ready: true
      manifestDigest: string
      verifiedAt: string
    }
  | { ready: false; reason: string; manifestDigest?: string }

export async function getDevotionalCutoverReadiness(
  database: QueryExecutor,
): Promise<DevotionalCutoverReadiness> {
  try {
    const result = await database.query<{
      ready: boolean
      manifest_digest: string | null
      reason: string | null
      verified_at: Date | string | null
    }>(
      `select ready, manifest_digest, reason, verified_at
         from ${DEVOTIONAL_WORKSPACE_SCHEMA}.workspace_readiness
        where singleton = true`,
    )
    const row = result.rows[0]
    if (
      row?.ready === true &&
      row.manifest_digest != null &&
      /^[a-f0-9]{64}$/u.test(row.manifest_digest) &&
      row.verified_at != null
    ) {
      return {
        ready: true,
        manifestDigest: row.manifest_digest,
        verifiedAt: (row.verified_at instanceof Date
          ? row.verified_at
          : new Date(row.verified_at)
        ).toISOString(),
      }
    }
    return {
      ready: false,
      reason: row?.reason ?? "devotional Workspace cutover is not enabled",
      ...(row?.manifest_digest ? { manifestDigest: row.manifest_digest } : {}),
    }
  } catch {
    return {
      ready: false,
      reason: "devotional Workspace cutover readiness is unavailable",
    }
  }
}

export async function commitDevotionalWorkspaceReadiness(options: {
  database: DevotionalDatabase
  manifestDigest: string
  verifiedAt?: Date
}): Promise<void> {
  if (!/^[a-f0-9]{64}$/u.test(options.manifestDigest)) {
    throw new Error("invalid devotional Workspace manifest digest")
  }
  const result = await options.database.query(
    `update ${DEVOTIONAL_WORKSPACE_SCHEMA}.workspace_readiness
        set ready = true, manifest_digest = $1, reason = null,
            verified_at = $2, updated_at = now()
      where singleton = true`,
    [options.manifestDigest, options.verifiedAt ?? new Date()],
  )
  if (result.rowCount !== 1) {
    throw new Error("devotional Workspace readiness row is unavailable")
  }
}

export async function disableDevotionalWorkspaceReadiness(options: {
  database: DevotionalDatabase
  reason: string
}): Promise<void> {
  const result = await options.database.query(
    `update ${DEVOTIONAL_WORKSPACE_SCHEMA}.workspace_readiness
        set ready = false, reason = $1, verified_at = null, updated_at = now()
      where singleton = true`,
    [options.reason.slice(0, 2_000)],
  )
  if (result.rowCount !== 1) {
    throw new Error("devotional Workspace readiness row is unavailable")
  }
}

export function createDatabaseAuditSink(
  database: QueryExecutor,
): WorkspaceMutationAuditSink {
  return async (record: WorkspaceMutationAuditRecord) => {
    await database.query(
      `insert into ${DEVOTIONAL_WORKSPACE_SCHEMA}.filesystem_mutation_audit
        (id, operation_id, phase, occurred_at, actor_id, request_id, action,
         path, target_path, pre_digest, post_digest,
         trusted_editorial_rights_assertion)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        record.id,
        record.operationId,
        record.phase,
        record.occurredAt,
        record.actorId,
        record.requestId,
        record.action,
        record.path,
        record.targetPath ?? null,
        record.preDigest ?? null,
        record.postDigest ?? null,
        record.trustedEditorialRightsAssertion,
      ],
    )
  }
}

let devotionalDatabase: DevotionalDatabase | undefined

/** One lazily-created direct SQL pool for all devotional Workspace state. */
export function getDevotionalDatabase(): DevotionalDatabase {
  if (!devotionalDatabase) {
    const environment = getDevotionalWorkspaceEnvironment()
    devotionalDatabase = createDevotionalDatabase({
      connectionString: environment.databaseUrl,
      maxConnections: environment.databasePoolMax,
    })
  }
  return devotionalDatabase
}
