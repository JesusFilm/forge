import { createHash } from "node:crypto"
import { open, readFile } from "node:fs/promises"
import { dirname, isAbsolute, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { Client } from "pg"

const TABLE = "watch_surface_exposure"
const WIDE = "watch_surface_exposure_window_item_idx"
const NARROW = "watch_surface_exposure_window_item_narrow_idx"
const WIDE_KEYS = [
  "window_id",
  "surface",
  "block",
  "presentation",
  "placement",
  "position",
  "item_path",
  "kind",
]
const NARROW_KEYS = WIDE_KEYS.slice(0, 6)
const LOCK_NAMESPACE = 806515
const LOCK_RESOURCE = 574
const LOCK_TIMEOUT = "250ms"

export type ExposureIndexAction = "inspect" | "create-narrow" | "drop-wide"

export type ExposureIndexArgs = {
  action: ExposureIndexAction
  execute: boolean
  expectedTargetHash?: string
  expectedSourceHash?: string
  expectedRevision?: string
  receiptPath?: string
}

export class ExposureIndexOperatorError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ExposureIndexOperatorError"
  }
}

type IndexCatalog = {
  name: string
  keys: string[]
  valid: boolean
  ready: boolean
  live: boolean
  unique: boolean
  primary: boolean
  exclusion: boolean
  keyCount: number
  attributeCount: number
  method: string
  predicate: string | null
  expressions: string | null
  constraintName: string | null
  bytes: string
  definition: string
}

type DatabaseInspection = {
  targetHash: string
  schema: string
  tableExists: boolean
  candidateNameOccupied: boolean
  indexes: IndexCatalog[]
  activeBuilds: number
  lockWaiters: number
  oldTransactions: number
  tableBytes: string | null
  totalBytes: string | null
  walLsn: string
}

const sha256 = (value: string | Buffer) =>
  createHash("sha256").update(value).digest("hex")

export function parseExposureIndexArgs(argv: string[]): ExposureIndexArgs {
  const [action, ...flags] = argv
  if (!action || !["inspect", "create-narrow", "drop-wide"].includes(action))
    throw new ExposureIndexOperatorError(
      "Expected inspect, create-narrow, or drop-wide",
    )
  const values = new Map<string, string>()
  let execute = false
  for (const flag of flags) {
    if (flag === "--execute") {
      if (execute) throw new ExposureIndexOperatorError("Duplicate --execute")
      execute = true
      continue
    }
    const match = /^--(target|source|revision|receipt)=(.+)$/.exec(flag)
    if (!match || values.has(match[1]!))
      throw new ExposureIndexOperatorError("Unknown or duplicate operator flag")
    values.set(match[1]!, match[2]!)
  }
  if (action === "inspect" && (execute || values.size))
    throw new ExposureIndexOperatorError("inspect accepts no flags")
  if (!execute && values.size)
    throw new ExposureIndexOperatorError("Admission flags require --execute")
  if (execute) {
    if (
      !/^[a-f0-9]{64}$/.test(values.get("target") ?? "") ||
      !/^[a-f0-9]{64}$/.test(values.get("source") ?? "") ||
      !/^[a-f0-9]{40}$/.test(values.get("revision") ?? "") ||
      !isAbsolute(values.get("receipt") ?? "")
    )
      throw new ExposureIndexOperatorError(
        "Execution requires exact --target, --source, --revision and absolute --receipt",
      )
  }
  return {
    action: action as ExposureIndexAction,
    execute,
    expectedTargetHash: values.get("target"),
    expectedSourceHash: values.get("source"),
    expectedRevision: values.get("revision"),
    receiptPath: values.get("receipt"),
  }
}

export function assertOperatorDatabaseUrl(url: string): void {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new ExposureIndexOperatorError("Invalid DATABASE_URL")
  }
  if (
    !["postgres:", "postgresql:"].includes(parsed.protocol) ||
    !parsed.hostname ||
    !parsed.pathname ||
    parsed.hash ||
    [...parsed.searchParams.keys()].some((key) =>
      ["host", "hostaddr", "port", "dbname", "database"].includes(
        key.toLowerCase(),
      ),
    )
  )
    throw new ExposureIndexOperatorError("Unsupported DATABASE_URL authority")
}

export function assertIndexShape(
  index: IndexCatalog | undefined,
  name: string,
  keys: string[],
): void {
  const definition = `CREATE INDEX ${name} ON public.${TABLE} USING btree (${keys
    .map((key) => (key === "position" ? '"position"' : key))
    .join(", ")})`
  if (
    !index ||
    index.name !== name ||
    !index.valid ||
    !index.ready ||
    !index.live ||
    index.unique ||
    index.primary ||
    index.exclusion ||
    index.method !== "btree" ||
    index.keyCount !== keys.length ||
    index.attributeCount !== keys.length ||
    index.predicate !== null ||
    index.expressions !== null ||
    index.constraintName !== null ||
    index.definition !== definition ||
    index.keys.length !== keys.length ||
    index.keys.some((key, at) => key !== keys[at])
  )
    throw new ExposureIndexOperatorError(
      `Unexpected or invalid ${name} catalog`,
    )
}

export function assertActionState(
  action: ExposureIndexAction,
  state: DatabaseInspection,
): void {
  if (action === "inspect") return
  if (!state.tableExists || state.schema !== "public")
    throw new ExposureIndexOperatorError(
      "Expected public exposure table missing",
    )
  if (state.activeBuilds || state.lockWaiters || state.oldTransactions)
    throw new ExposureIndexOperatorError(
      "Index build, lock waiter, or old transaction present",
    )
  const wide = state.indexes.find((index) => index.name === WIDE)
  const narrow = state.indexes.find((index) => index.name === NARROW)
  assertIndexShape(wide, WIDE, WIDE_KEYS)
  if (action === "create-narrow" && (narrow || state.candidateNameOccupied))
    throw new ExposureIndexOperatorError(
      "Candidate name already exists; inspect before any manual recovery",
    )
  if (action === "drop-wide") assertIndexShape(narrow, NARROW, NARROW_KEYS)
}

async function inspect(client: Client): Promise<DatabaseInspection> {
  const identity = await client.query<{
    fingerprint: string
    schema: string
    table_oid: string | null
    candidate_name_occupied: boolean
    table_bytes: string | null
    total_bytes: string | null
    wal_lsn: string
  }>(`
    SELECT concat_ws(':', current_database(), current_schema(),
             coalesce(inet_server_addr()::text, 'unix'),
             inet_server_port()::text) AS fingerprint,
           current_schema() AS schema,
           c.oid::text AS table_oid,
           to_regclass('public.${NARROW}') IS NOT NULL AS candidate_name_occupied,
           CASE WHEN c.oid IS NULL THEN NULL ELSE pg_relation_size(c.oid)::text END AS table_bytes,
           CASE WHEN c.oid IS NULL THEN NULL ELSE pg_total_relation_size(c.oid)::text END AS total_bytes,
           pg_current_wal_lsn()::text AS wal_lsn
    FROM (SELECT 1) seed
    LEFT JOIN pg_namespace n ON n.nspname = 'public'
    LEFT JOIN pg_class c ON c.relnamespace = n.oid
      AND c.relname = '${TABLE}' AND c.relkind = 'r'
  `)
  const row = identity.rows[0]
  if (!row)
    throw new ExposureIndexOperatorError("Database identity unavailable")
  const indexRows = await client.query<{
    name: string
    keys: string[]
    valid: boolean
    ready: boolean
    live: boolean
    unique: boolean
    primary: boolean
    exclusion: boolean
    key_count: number
    attribute_count: number
    method: string
    predicate: string | null
    expressions: string | null
    constraint_name: string | null
    bytes: string
    definition: string
  }>(`
    SELECT ic.relname AS name,
           ARRAY(SELECT a.attname::text
                 FROM generate_series(0, i.indnkeyatts - 1) AS key_position
                 JOIN pg_attribute a ON a.attrelid = i.indrelid
                   AND a.attnum = i.indkey[key_position]
                 ORDER BY key_position)::text[] AS keys,
           i.indisvalid AS valid, i.indisready AS ready,
           i.indislive AS live, i.indisunique AS unique,
           i.indisprimary AS primary, i.indisexclusion AS exclusion,
           i.indnkeyatts AS key_count, i.indnatts AS attribute_count,
           am.amname AS method, pg_get_expr(i.indpred, i.indrelid) AS predicate,
           pg_get_expr(i.indexprs, i.indrelid) AS expressions,
           con.conname AS constraint_name,
           pg_relation_size(ic.oid)::text AS bytes,
           pg_get_indexdef(ic.oid) AS definition
    FROM pg_class tc
    JOIN pg_namespace n ON n.oid = tc.relnamespace AND n.nspname = 'public'
    JOIN pg_index i ON i.indrelid = tc.oid
    JOIN pg_class ic ON ic.oid = i.indexrelid
    JOIN pg_am am ON am.oid = ic.relam
    LEFT JOIN pg_constraint con ON con.conindid = ic.oid
    WHERE tc.relname = '${TABLE}'
      AND ic.relname IN ('${WIDE}', '${NARROW}')
    ORDER BY ic.relname
  `)
  const indexes: IndexCatalog[] = indexRows.rows.map((index) => ({
    name: index.name,
    keys: index.keys,
    valid: index.valid,
    ready: index.ready,
    live: index.live,
    unique: index.unique,
    primary: index.primary,
    exclusion: index.exclusion,
    keyCount: index.key_count,
    attributeCount: index.attribute_count,
    method: index.method,
    predicate: index.predicate,
    expressions: index.expressions,
    constraintName: index.constraint_name,
    bytes: index.bytes,
    definition: index.definition,
  }))
  const activity = await client.query<{
    active_builds: string
    lock_waiters: string
    old_transactions: string
  }>(
    `
    SELECT (SELECT count(*) FROM pg_stat_progress_create_index
            WHERE relid = $1::oid)::text AS active_builds,
           (SELECT count(*) FROM pg_locks
            WHERE NOT granted AND relation IN (
              SELECT oid FROM pg_class WHERE oid = $1::oid
              UNION ALL
              SELECT ic.oid FROM pg_class ic JOIN pg_namespace n
                ON n.oid = ic.relnamespace AND n.nspname = 'public'
              WHERE ic.relname IN ('${WIDE}', '${NARROW}')
            ))::text AS lock_waiters,
           (SELECT count(*) FROM pg_stat_activity
            WHERE datid = (SELECT oid FROM pg_database WHERE datname = current_database())
              AND pid <> pg_backend_pid()
              AND backend_type = 'client backend'
              AND xact_start < now() - interval '5 seconds')::text AS old_transactions
  `,
    [row.table_oid],
  )
  return {
    targetHash: sha256(row.fingerprint),
    schema: row.schema,
    tableExists: row.table_oid !== null,
    candidateNameOccupied: row.candidate_name_occupied,
    indexes,
    activeBuilds: Number(activity.rows[0]?.active_builds ?? 0),
    lockWaiters: Number(activity.rows[0]?.lock_waiters ?? 0),
    oldTransactions: Number(activity.rows[0]?.old_transactions ?? 0),
    tableBytes: row.table_bytes,
    totalBytes: row.total_bytes,
    walLsn: row.wal_lsn,
  }
}

export async function writeAttemptReceipt(path: string, receipt: object) {
  const handle = await open(path, "wx", 0o600)
  try {
    await handle.writeFile(JSON.stringify(receipt, null, 2) + "\n")
    await handle.sync()
  } finally {
    await handle.close()
  }
  // Persist the new directory entry too. An absent receipt after a host crash
  // must never make an attempted DDL operation look safe to replay.
  const directory = await open(dirname(path), "r")
  try {
    await directory.sync()
  } finally {
    await directory.close()
  }
}

export async function runExposureIndexOperator(
  args: ExposureIndexArgs,
  options: {
    databaseUrl: string
    revision?: string
    statementTimeoutMs?: number
    /** Native fault-injection seam; the deployed CLI always constructs its own client. */
    clientFactory?: () => Client
  },
) {
  assertOperatorDatabaseUrl(options.databaseUrl)
  const sourceHash = sha256(await readFile(fileURLToPath(import.meta.url)))
  const client =
    options.clientFactory?.() ??
    new Client({
      connectionString: options.databaseUrl,
      connectionTimeoutMillis: 2_000,
      query_timeout: 125_000,
      application_name: "forge-watch-exposure-online-index-operator",
    })
  let locked = false
  try {
    await client.connect()
    if (args.execute) {
      const lock = await client.query<{ acquired: boolean }>(
        "SELECT pg_try_advisory_lock($1, $2) AS acquired",
        [LOCK_NAMESPACE, LOCK_RESOURCE],
      )
      if (!lock.rows[0]?.acquired)
        throw new ExposureIndexOperatorError(
          "Another exposure operator holds the lock",
        )
      locked = true
    }
    const before = await inspect(client)
    assertActionState(args.action, before)
    const admission = {
      action: args.action,
      targetHash: before.targetHash,
      sourceHash,
      revision: options.revision ?? null,
      before,
    }
    if (!args.execute) return { ...admission, dryRun: true }
    if (
      args.expectedTargetHash !== before.targetHash ||
      args.expectedSourceHash !== sourceHash ||
      args.expectedRevision !== options.revision ||
      !args.receiptPath
    )
      throw new ExposureIndexOperatorError(
        "Target, source, or deployed revision does not match reviewed admission",
      )
    await writeAttemptReceipt(args.receiptPath, {
      ...admission,
      startedAt: new Date().toISOString(),
      state: "attempted; reconcile database/catalog on any uncertain result",
    })
    await client.query(`SET lock_timeout = '${LOCK_TIMEOUT}'`)
    const statementTimeoutMs = options.statementTimeoutMs ?? 120_000
    if (
      !Number.isInteger(statementTimeoutMs) ||
      statementTimeoutMs < 1 ||
      statementTimeoutMs > 120_000
    )
      throw new ExposureIndexOperatorError("Invalid statement timeout")
    await client.query("SELECT set_config('statement_timeout', $1, false)", [
      `${statementTimeoutMs}ms`,
    ])
    // PostgreSQL requires each CONCURRENTLY statement to be top-level/autocommit.
    if (args.action === "create-narrow")
      await client.query(
        `CREATE INDEX CONCURRENTLY ${NARROW} ON public.${TABLE}
         (window_id, surface, block, presentation, placement, position)`,
      )
    else if (args.action === "drop-wide")
      await client.query(`DROP INDEX CONCURRENTLY public.${WIDE}`)
    else throw new ExposureIndexOperatorError("inspect is read-only")
    const after = await inspect(client)
    if (args.action === "create-narrow") {
      assertIndexShape(
        after.indexes.find((index) => index.name === WIDE),
        WIDE,
        WIDE_KEYS,
      )
      assertIndexShape(
        after.indexes.find((index) => index.name === NARROW),
        NARROW,
        NARROW_KEYS,
      )
    } else {
      if (after.indexes.some((index) => index.name === WIDE))
        throw new ExposureIndexOperatorError("Old wide index still present")
      assertIndexShape(
        after.indexes.find((index) => index.name === NARROW),
        NARROW,
        NARROW_KEYS,
      )
    }
    return { ...admission, dryRun: false, after }
  } catch (error) {
    if (error instanceof ExposureIndexOperatorError) throw error
    throw new ExposureIndexOperatorError(
      `Operation failed or outcome uncertain (${error instanceof Error && "code" in error ? String(error.code) : "transport"}); inspect backend and catalog, never auto-retry or clean up`,
    )
  } finally {
    if (locked)
      await client
        .query("SELECT pg_advisory_unlock($1, $2)", [
          LOCK_NAMESPACE,
          LOCK_RESOURCE,
        ])
        .catch(() => {})
    await client.end().catch(() => {})
  }
}

async function main() {
  const args = parseExposureIndexArgs(process.argv.slice(2))
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl)
    throw new ExposureIndexOperatorError("DATABASE_URL is required")
  const result = await runExposureIndexOperator(args, {
    databaseUrl,
    revision: process.env.RAILWAY_GIT_COMMIT_SHA,
  })
  process.stdout.write(JSON.stringify(result, null, 2) + "\n")
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
)
  main().catch((error: unknown) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : "Exposure index operation failed"}\n`,
    )
    process.exitCode = 1
  })
